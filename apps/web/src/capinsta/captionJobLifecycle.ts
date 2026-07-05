import type { CapinstaJobDetailResponse } from "./apiTypes"

export type NormalizedCapinstaJobStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown"

export type CapinstaJobLifecycleSource =
  | "poll"
  | "websocket"
  | "initial-load"
  | "timeout-reconcile"
  | "heartbeat"

export interface CapinstaJobLifecycleState {
  jobId: string
  status: NormalizedCapinstaJobStatus
  rawStatus: string
  statusVersion: number
  updatedAt: string
  terminalAt?: string
  source: CapinstaJobLifecycleSource
}

const COMPLETE_STATUSES = new Set([
  "completed",
  "complete",
  "succeeded",
  "success",
  "done",
])
const FAILED_STATUSES = new Set(["failed", "failure", "error"])
const CANCELLED_STATUSES = new Set(["cancelled", "canceled"])
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

const terminalJobIds = new Set<string>()

export function normalizeCapinstaJobStatus(
  status: string | null | undefined,
): NormalizedCapinstaJobStatus {
  const normalized = (status ?? "").trim().toLowerCase()
  if (COMPLETE_STATUSES.has(normalized)) return "completed"
  if (CANCELLED_STATUSES.has(normalized)) return "cancelled"
  if (FAILED_STATUSES.has(normalized)) return "failed"
  if (RUNNING_STATUSES.has(normalized)) return "running"
  return "unknown"
}

export function isTerminalCapinstaStatus(
  status: string | null | undefined,
): boolean {
  return ["completed", "failed", "cancelled"].includes(
    normalizeCapinstaJobStatus(status),
  )
}

function timestampVersion(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function lifecycleStateFromJob(
  job: CapinstaJobDetailResponse,
  source: CapinstaJobLifecycleSource,
): CapinstaJobLifecycleState {
  const status = normalizeCapinstaJobStatus(job.status)
  const updatedAt =
    job.updatedAt ||
    job.completedAt ||
    job.completed_at ||
    job.workerHeartbeatAt ||
    job.heartbeatAt ||
    job.createdAt ||
    new Date().toISOString()
  const statusVersion =
    typeof job.statusVersion === "number" && Number.isFinite(job.statusVersion)
      ? job.statusVersion
      : timestampVersion(updatedAt)
  return {
    jobId: job.job_id,
    status,
    rawStatus: String(job.status ?? ""),
    statusVersion,
    updatedAt,
    ...(status === "completed" || status === "failed" || status === "cancelled"
      ? { terminalAt: job.completedAt || job.completed_at || updatedAt }
      : {}),
    source,
  }
}

export function rememberTerminalCapinstaJob(jobId: string): void {
  if (jobId) terminalJobIds.add(jobId)
}

export function forgetTerminalCapinstaJob(jobId: string): void {
  terminalJobIds.delete(jobId)
}

export function isKnownTerminalCapinstaJob(jobId: string | null | undefined): boolean {
  return Boolean(jobId && terminalJobIds.has(jobId))
}

export function acceptCapinstaJobLifecycleUpdate(
  current: CapinstaJobLifecycleState | null | undefined,
  next: CapinstaJobLifecycleState,
): { accepted: boolean; state: CapinstaJobLifecycleState; reason?: string } {
  if (current?.terminalAt && !next.terminalAt) {
    return { accepted: false, state: current, reason: "terminal_state_is_authoritative" }
  }
  if (
    current &&
    next.statusVersion < current.statusVersion &&
    !next.terminalAt
  ) {
    return { accepted: false, state: current, reason: "stale_status_version" }
  }
  if (next.terminalAt) {
    rememberTerminalCapinstaJob(next.jobId)
  }
  return { accepted: true, state: next }
}
