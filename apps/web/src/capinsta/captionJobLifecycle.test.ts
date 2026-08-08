import { describe, expect, test } from "bun:test"
import {
  acceptCapinstaJobLifecycleUpdate,
  isKnownTerminalCapinstaJob,
  lifecycleStateFromJob,
  normalizeCapinstaJobStatus,
} from "./captionJobLifecycle"

describe("Capinsta caption job lifecycle", () => {
  test("normalizes terminal and running statuses", () => {
    expect(normalizeCapinstaJobStatus("completed")).toBe("completed")
    expect(normalizeCapinstaJobStatus("done")).toBe("completed")
    expect(normalizeCapinstaJobStatus("failed")).toBe("failed")
    expect(normalizeCapinstaJobStatus("canceled")).toBe("cancelled")
    expect(normalizeCapinstaJobStatus("normalizing")).toBe("running")
    expect(normalizeCapinstaJobStatus("future-stage")).toBe("unknown")
  })

  test("terminal backend status is authoritative over stale running status", () => {
    const completed = lifecycleStateFromJob(
      {
        job_id: "job-terminal",
        status: "completed",
        statusVersion: 10,
        updatedAt: "2026-07-05T07:14:31.370Z",
        completedAt: "2026-07-05T07:14:31.370Z",
        progress: 100,
        filename: "sample.mp4",
      },
      "poll",
    )
    const acceptedTerminal = acceptCapinstaJobLifecycleUpdate(null, completed)
    const staleRunning = lifecycleStateFromJob(
      {
        job_id: "job-terminal",
        status: "normalizing",
        statusVersion: 9,
        updatedAt: "2026-07-05T07:14:20.000Z",
        progress: 89,
        filename: "sample.mp4",
      },
      "poll",
    )

    const result = acceptCapinstaJobLifecycleUpdate(
      acceptedTerminal.state,
      staleRunning,
    )

    expect(result.accepted).toBe(false)
    expect(result.state.status).toBe("completed")
    expect(isKnownTerminalCapinstaJob("job-terminal")).toBe(true)
  })

  test("newer terminal status wins even after running status", () => {
    const running = lifecycleStateFromJob(
      {
        job_id: "job-terminal-2",
        status: "transcribing",
        statusVersion: 3,
        updatedAt: "2026-07-05T07:14:00.000Z",
        progress: 18,
        filename: "sample.mp4",
      },
      "poll",
    )
    const completed = lifecycleStateFromJob(
      {
        job_id: "job-terminal-2",
        status: "completed",
        statusVersion: 4,
        updatedAt: "2026-07-05T07:14:31.370Z",
        completedAt: "2026-07-05T07:14:31.370Z",
        progress: 100,
        filename: "sample.mp4",
      },
      "timeout-reconcile",
    )

    const result = acceptCapinstaJobLifecycleUpdate(running, completed)

    expect(result.accepted).toBe(true)
    expect(result.state.status).toBe("completed")
    expect(result.state.terminalAt).toBe("2026-07-05T07:14:31.370Z")
  })
})
