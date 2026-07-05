import type { CapinstaJobDetailResponse } from "./apiTypes"
import { getCapinstaJob } from "./apiClient"
import {
  acceptCapinstaJobLifecycleUpdate,
  lifecycleStateFromJob,
  normalizeCapinstaJobStatus,
  rememberTerminalCapinstaJob,
  type CapinstaJobLifecycleState,
} from "./captionJobLifecycle"

export { normalizeCapinstaJobStatus } from "./captionJobLifecycle"

export interface CapinstaJobStatusHistoryEntry {
  jobId: string
  rawStatus: string
  normalizedStatus: ReturnType<typeof normalizeCapinstaJobStatus>
  timestamp: string
  progress?: number
  message?: string
  provider?: string | null
  currentChunk?: number | null
  totalChunks?: number | null
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
  onLifecycle?: (state: CapinstaJobLifecycleState) => void
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
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
      const chunk =
        entry.currentChunk && entry.totalChunks
          ? ` chunk ${entry.currentChunk}/${entry.totalChunks}`
          : ""
      const provider = entry.provider ? ` ${entry.provider}` : ""
      const message = entry.message ? ` · ${entry.message}` : ""
      return `${entry.rawStatus || "(empty)"}(${entry.normalizedStatus})${progress}${provider}${chunk}${message}`
    })
    .join(" -> ")
}

function historyEntryKey(entry: CapinstaJobStatusHistoryEntry): string {
  return [
    entry.rawStatus,
    entry.normalizedStatus,
    entry.progress ?? "",
    entry.provider ?? "",
    entry.currentChunk ?? "",
    entry.totalChunks ?? "",
    entry.message ?? "",
  ].join("|")
}

function timeoutError({
  maxElapsedMs,
  history,
  job,
}: {
  maxElapsedMs?: number
  history: readonly CapinstaJobStatusHistoryEntry[]
  job?: CapinstaJobDetailResponse
}): Error {
  const durationMessage =
    typeof maxElapsedMs === "number"
      ? ` after ${Math.round(maxElapsedMs / 1000)} seconds`
      : ""
  return new Error(
    `Timed out waiting for Capinsta caption generation${durationMessage}. Job ${job?.job_id ?? "unknown"} is still ${job?.status ?? "non-terminal"} at ${job?.progress ?? "unknown"}%. Last worker heartbeat: ${job?.heartbeatAt ?? "unknown"}. Status history: ${formatStatusHistory(history)}`,
  )
}

function terminalError(job: CapinstaJobDetailResponse): Error {
  const normalized = normalizeCapinstaJobStatus(job.status)
  if (normalized === "cancelled") {
    return new Error(job.error || job.message || `Capinsta job ${job.job_id} was cancelled`)
  }
  return new Error(job.error || job.message || `Capinsta job ${job.status}`)
}

export async function pollCapinstaJobUntilDone({
  baseUrl,
  jobId,
  intervalMs = 2000,
  maxAttempts = Number.POSITIVE_INFINITY,
  maxElapsedMs = 10 * 60 * 1000,
  fetchImpl = fetch,
  signal,
  sleep = defaultSleep,
  onProgress,
  onStatusHistory,
  onLifecycle,
}: PollCapinstaJobOptions): Promise<CapinstaJobDetailResponse> {
  const startedAt = Date.now()
  const reconcileIntervalMs = Math.max(0, maxElapsedMs)
  let nextReconcileAt = startedAt + reconcileIntervalMs
  const statusHistory: CapinstaJobStatusHistoryEntry[] = []
  let terminalJob: CapinstaJobDetailResponse | null = null
  let lifecycleState: CapinstaJobLifecycleState | null = null
  let lastJob: CapinstaJobDetailResponse | undefined
  const recordStatus = (
    job: CapinstaJobDetailResponse,
    normalizedStatus: ReturnType<typeof normalizeCapinstaJobStatus>,
  ) => {
    const historyEntry: CapinstaJobStatusHistoryEntry = {
      jobId,
      rawStatus: String(job.status ?? ""),
      normalizedStatus,
      timestamp: new Date().toISOString(),
      ...(typeof job.progress === "number" && { progress: job.progress }),
      ...((job.message || job.details) && {
        message: job.message || job.details || undefined,
      }),
      provider: job.currentProvider ?? null,
      currentChunk: job.currentChunk ?? null,
      totalChunks: job.totalChunks ?? null,
    }
    const previous = statusHistory.at(-1)
    if (!previous || historyEntryKey(previous) !== historyEntryKey(historyEntry)) {
      statusHistory.push(historyEntry)
      if (statusHistory.length > 50) {
        statusHistory.splice(0, statusHistory.length - 50)
      }
      onStatusHistory?.([...statusHistory])
    }
  }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Capinsta caption generation was cancelled", "AbortError")
    }
    if (reconcileIntervalMs > 0 && Date.now() >= nextReconcileAt) {
      console.warn("[Capinsta captions] Client timeout fired; reconciling final backend status", {
        jobId,
        maxElapsedMs,
        lastStatus: lastJob?.status,
        lastProgress: lastJob?.progress,
        lastWorkerHeartbeat: lastJob?.heartbeatAt,
      })
      const reconciledJob = await getCapinstaJob({ baseUrl, jobId, fetchImpl })
      const reconciledLifecycle = lifecycleStateFromJob(reconciledJob, "timeout-reconcile")
      const acceptedLifecycle = acceptCapinstaJobLifecycleUpdate(lifecycleState, reconciledLifecycle)
      lifecycleState = acceptedLifecycle.state
      onLifecycle?.(lifecycleState)
      const reconciledStatus = normalizeCapinstaJobStatus(reconciledJob.status)
      console.warn("[Capinsta captions] Final status reconciliation result", {
        jobId,
        status: reconciledJob.status,
        normalizedStatus: reconciledStatus,
        progress: reconciledJob.progress,
        updatedAt: reconciledJob.updatedAt,
        completedAt: reconciledJob.completedAt || reconciledJob.completed_at,
      })
      if (reconciledStatus === "completed") {
        rememberTerminalCapinstaJob(jobId)
        return reconciledJob
      }
      if (reconciledStatus === "failed" || reconciledStatus === "cancelled") {
        rememberTerminalCapinstaJob(jobId)
        throw terminalError(reconciledJob)
      }
      lastJob = reconciledJob
      recordStatus(reconciledJob, reconciledStatus)
      onProgress?.(reconciledJob)
      console.warn("[Capinsta captions] Backend still non-terminal after local timeout; continuing polling", {
        jobId,
        status: reconciledJob.status,
        normalizedStatus: reconciledStatus,
        progress: reconciledJob.progress,
        workerHeartbeatAt: reconciledJob.workerHeartbeatAt || reconciledJob.heartbeatAt,
      })
      nextReconcileAt = Date.now() + reconcileIntervalMs
      await sleep(intervalMs)
      continue
    }
    if (reconcileIntervalMs <= 0 && Date.now() - startedAt >= maxElapsedMs) {
      const reconciledJob = await getCapinstaJob({ baseUrl, jobId, fetchImpl })
      const reconciledStatus = normalizeCapinstaJobStatus(reconciledJob.status)
      if (reconciledStatus === "completed") {
        rememberTerminalCapinstaJob(jobId)
        return reconciledJob
      }
      if (reconciledStatus === "failed" || reconciledStatus === "cancelled") {
        rememberTerminalCapinstaJob(jobId)
        throw terminalError(reconciledJob)
      }
      throw timeoutError({ maxElapsedMs, history: statusHistory, job: reconciledJob })
    }

    const job = await getCapinstaJob({ baseUrl, jobId, fetchImpl, signal })
    lastJob = job
    const normalizedStatus = normalizeCapinstaJobStatus(job.status)
    const nextLifecycle = lifecycleStateFromJob(job, "poll")
    const acceptedLifecycle = acceptCapinstaJobLifecycleUpdate(lifecycleState, nextLifecycle)
    lifecycleState = acceptedLifecycle.state
    if (!acceptedLifecycle.accepted) {
      console.debug("[Capinsta captions] Ignored stale lifecycle update", {
        jobId,
        reason: acceptedLifecycle.reason,
        staleStatus: job.status,
        terminalStatus: lifecycleState.status,
      })
      if (lifecycleState.terminalAt && terminalJob) return terminalJob
    } else {
      onLifecycle?.(lifecycleState)
    }
    recordStatus(job, normalizedStatus)
    console.debug("[Capinsta captions] Poll response", {
      jobId,
      status: job.status,
      normalizedStatus,
      progress: job.progress,
      error: job.error,
      attempt: attempt + 1,
    })
    onProgress?.(job)

    if (normalizedStatus === "completed") {
      terminalJob = job
      rememberTerminalCapinstaJob(jobId)
      console.debug("[Capinsta captions] Polling stopped after terminal completion", { jobId })
      return job
    }
    if (normalizedStatus === "failed" || normalizedStatus === "cancelled") {
      terminalJob = job
      rememberTerminalCapinstaJob(jobId)
      console.debug("[Capinsta captions] Polling stopped after terminal failure", {
        jobId,
        status: job.status,
      })
      throw terminalError(job)
    }

    await sleep(intervalMs)
  }

  throw timeoutError({ history: statusHistory, job: lastJob })
}
