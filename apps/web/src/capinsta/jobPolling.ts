import type { CapinstaJobDetailResponse } from "./apiTypes"
import { getCapinstaJob } from "./apiClient"

export type NormalizedCapinstaJobStatus =
  | "running"
  | "completed"
  | "failed"
  | "unknown"

export interface CapinstaJobStatusHistoryEntry {
  jobId: string
  rawStatus: string
  normalizedStatus: NormalizedCapinstaJobStatus
  timestamp: string
  progress?: number
  message?: string
}

export interface PollCapinstaJobOptions {
  baseUrl: string
  jobId: string
  intervalMs?: number
  maxAttempts?: number
  maxElapsedMs?: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  sleep?: (milliseconds: number) => Promise<void>
  onProgress?: (job: CapinstaJobDetailResponse) => void
  onStatusHistory?: (history: readonly CapinstaJobStatusHistoryEntry[]) => void
}

const COMPLETE_STATUSES = new Set([
  "completed",
  "complete",
  "succeeded",
  "success",
  "done",
])
const FAILED_STATUSES = new Set([
  "failed",
  "failure",
  "error",
  "cancelled",
  "canceled",
])
const RUNNING_STATUSES = new Set([
  "queued",
  "pending",
  "uploaded",
  "extracting",
  "processing",
  "running",
  "started",
  "extracting_audio",
  "transcribing",
  "aligning",
  "normalizing",
  "romanizing",
  "chunking",
  "rendering",
  "rendering_captions",
  "finalizing",
  "saving",
  "generating_captions",
  "importing_captions",
])

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export function normalizeCapinstaJobStatus(
  status: string | null | undefined,
): NormalizedCapinstaJobStatus {
  const normalized = (status ?? "").trim().toLowerCase()
  if (COMPLETE_STATUSES.has(normalized)) return "completed"
  if (FAILED_STATUSES.has(normalized)) return "failed"
  if (RUNNING_STATUSES.has(normalized)) return "running"
  return "unknown"
}

function formatStatusHistory(
  history: readonly CapinstaJobStatusHistoryEntry[],
): string {
  if (history.length === 0) return "No backend statuses were received."
  return history
    .slice(-12)
    .map((entry) => {
      const progress =
        typeof entry.progress === "number" ? ` ${entry.progress}%` : ""
      return `${entry.rawStatus || "(empty)"}(${entry.normalizedStatus})${progress}`
    })
    .join(" -> ")
}

function timeoutError({
  maxElapsedMs,
  history,
}: {
  maxElapsedMs?: number
  history: readonly CapinstaJobStatusHistoryEntry[]
}): Error {
  const durationMessage =
    typeof maxElapsedMs === "number"
      ? ` after ${Math.round(maxElapsedMs / 1000)} seconds`
      : ""
  return new Error(
    `Timed out waiting for Capinsta caption generation${durationMessage}. Status history: ${formatStatusHistory(history)}`,
  )
}

export async function pollCapinstaJobUntilDone({
  baseUrl,
  jobId,
  intervalMs = 2000,
  maxAttempts = 300,
  maxElapsedMs = 5 * 60 * 1000,
  fetchImpl = fetch,
  signal,
  sleep = defaultSleep,
  onProgress,
  onStatusHistory,
}: PollCapinstaJobOptions): Promise<CapinstaJobDetailResponse> {
  const startedAt = Date.now()
  const statusHistory: CapinstaJobStatusHistoryEntry[] = []
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Capinsta caption generation was cancelled", "AbortError")
    }
    if (Date.now() - startedAt >= maxElapsedMs) {
      throw timeoutError({ maxElapsedMs, history: statusHistory })
    }

    const job = await getCapinstaJob({ baseUrl, jobId, fetchImpl, signal })
    const normalizedStatus = normalizeCapinstaJobStatus(job.status)
    statusHistory.push({
      jobId,
      rawStatus: String(job.status ?? ""),
      normalizedStatus,
      timestamp: new Date().toISOString(),
      ...(typeof job.progress === "number" && { progress: job.progress }),
      ...((job.message || job.details) && {
        message: job.message || job.details || undefined,
      }),
    })
    onStatusHistory?.([...statusHistory])
    console.debug("[Capinsta captions] Poll response", {
      jobId,
      status: job.status,
      normalizedStatus,
      progress: job.progress,
      error: job.error,
      attempt: attempt + 1,
    })
    onProgress?.(job)

    if (normalizedStatus === "completed") return job
    if (normalizedStatus === "failed") {
      throw new Error(job.error || `Capinsta job ${job.status}`)
    }

    await sleep(intervalMs)
  }

  throw timeoutError({ history: statusHistory })
}
