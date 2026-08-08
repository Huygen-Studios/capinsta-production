import { describe, expect, test } from "bun:test"
import {
  normalizeCapinstaJobStatus,
  pollCapinstaJobUntilDone,
} from "./jobPolling"

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("Capinsta job polling", () => {
  test("normalizes backend job statuses", () => {
    expect(normalizeCapinstaJobStatus("queued")).toBe("running")
    expect(normalizeCapinstaJobStatus("uploaded")).toBe("running")
    expect(normalizeCapinstaJobStatus("extracting")).toBe("running")
    expect(normalizeCapinstaJobStatus("extracting_audio")).toBe("running")
    expect(normalizeCapinstaJobStatus("aligning")).toBe("running")
    expect(normalizeCapinstaJobStatus("normalizing")).toBe("running")
    expect(normalizeCapinstaJobStatus("romanizing")).toBe("running")
    expect(normalizeCapinstaJobStatus("chunking")).toBe("running")
    expect(normalizeCapinstaJobStatus("rendering")).toBe("running")
    expect(normalizeCapinstaJobStatus("rendering_captions")).toBe("running")
    expect(normalizeCapinstaJobStatus("finalizing")).toBe("running")
    expect(normalizeCapinstaJobStatus("saving")).toBe("running")
    expect(normalizeCapinstaJobStatus("started")).toBe("running")
    expect(normalizeCapinstaJobStatus("done")).toBe("completed")
    expect(normalizeCapinstaJobStatus("complete")).toBe("completed")
    expect(normalizeCapinstaJobStatus("succeeded")).toBe("completed")
    expect(normalizeCapinstaJobStatus("failure")).toBe("failed")
    expect(normalizeCapinstaJobStatus("error")).toBe("failed")
    expect(normalizeCapinstaJobStatus("canceled")).toBe("cancelled")
    expect(normalizeCapinstaJobStatus("cancelled")).toBe("cancelled")
    expect(normalizeCapinstaJobStatus("mystery")).toBe("unknown")
  })

  test.each(["rendering", "finalizing"])(
    "continues polling while the backend is %s",
    async (processingStatus) => {
      const statuses = [processingStatus, "completed"]
      const result = await pollCapinstaJobUntilDone({
        baseUrl: "http://127.0.0.1:8000",
        jobId: "job-001",
        intervalMs: 1,
        sleep: async () => undefined,
        fetchImpl: async () =>
          jsonResponse({
            job_id: "job-001",
            status: statuses.shift() ?? "completed",
            progress: statuses.length === 0 ? 100 : 95,
            filename: "sample.mp4",
            languageMode: "english",
            segments: [{ start: 0, end: 1, text: "Done", words: [] }],
          }),
      })

      expect(result.status).toBe("completed")
    },
  )

  test("polls until a job completes", async () => {
    const statuses = ["queued", "processing", "completed"]
    const seenProgress: number[] = []
    const result = await pollCapinstaJobUntilDone({
      baseUrl: "http://127.0.0.1:8000",
      jobId: "job-001",
      intervalMs: 1,
      sleep: async () => undefined,
      onProgress: (job) => seenProgress.push(job.progress),
      fetchImpl: async () =>
        jsonResponse({
          job_id: "job-001",
          status: statuses.shift() ?? "completed",
          progress: statuses.length === 0 ? 100 : 20,
          filename: "sample.mp4",
          languageMode: "english",
          segments: [
            { start: 0, end: 1, text: "Done", words: [] },
          ],
        }),
    })

    expect(result.status).toBe("completed")
    expect(seenProgress).toEqual([20, 20, 100])
  })

  test("continues polling while the backend is normalizing", async () => {
    const statuses = ["queued", "normalizing", "completed"]
    const seenStatuses: string[] = []
    const result = await pollCapinstaJobUntilDone({
      baseUrl: "http://127.0.0.1:8000",
      jobId: "job-001",
      intervalMs: 1,
      sleep: async () => undefined,
      onProgress: (job) => seenStatuses.push(job.status),
      fetchImpl: async () =>
        jsonResponse({
          job_id: "job-001",
          status: statuses.shift() ?? "completed",
          progress: statuses.length === 0 ? 100 : 65,
          filename: "sample.mp4",
          languageMode: "english",
          segments: [
            { start: 0, end: 1, text: "Done", words: [] },
          ],
        }),
    })

    expect(result.status).toBe("completed")
    expect(seenStatuses).toEqual(["queued", "normalizing", "completed"])
  })

  test("throws when a job fails", async () => {
    await expect(
      pollCapinstaJobUntilDone({
        baseUrl: "http://127.0.0.1:8000",
        jobId: "job-001",
        sleep: async () => undefined,
        fetchImpl: async () =>
          jsonResponse({
            job_id: "job-001",
            status: "failed",
            progress: -1,
            filename: "sample.mp4",
            languageMode: "english",
            error: "provider unavailable",
          }),
      }),
    ).rejects.toThrow(/provider unavailable/)
  })

  test("throws when a job times out by elapsed time", async () => {
    await expect(
      pollCapinstaJobUntilDone({
        baseUrl: "http://127.0.0.1:8000",
        jobId: "job-001",
        intervalMs: 0,
        maxAttempts: 10,
        maxElapsedMs: 0,
        sleep: async () => undefined,
        fetchImpl: async () =>
          jsonResponse({
            job_id: "job-001",
            status: "queued",
            progress: 0,
            filename: "sample.mp4",
            languageMode: "english",
          }),
      }),
    ).rejects.toThrow(/Timed out waiting/)
  })

  test("reconciles timeout with a completed backend job", async () => {
    const originalNow = Date.now
    const times = [0, 601_000]
    Date.now = () => times.shift() ?? 601_000
    const calls: string[] = []
    try {
      const result = await pollCapinstaJobUntilDone({
        baseUrl: "http://127.0.0.1:8000",
        jobId: "job-001",
        maxElapsedMs: 600_000,
        fetchImpl: async (_url, init) => {
          calls.push(init?.signal ? "poll" : "reconcile")
          return jsonResponse({
            job_id: "job-001",
            status: "completed",
            progress: 100,
            filename: "sample.mp4",
            languageMode: "english",
            segments: [{ start: 0, end: 1, text: "Done", words: [] }],
            completed_at: "2026-07-05T07:14:31.370Z",
          })
        },
      })

      expect(result.status).toBe("completed")
      expect(calls).toEqual(["reconcile"])
    } finally {
      Date.now = originalNow
    }
  })

  test("reconciles timeout with a failed backend job", async () => {
    const originalNow = Date.now
    const times = [0, 601_000]
    Date.now = () => times.shift() ?? 601_000
    try {
      await expect(
        pollCapinstaJobUntilDone({
          baseUrl: "http://127.0.0.1:8000",
          jobId: "job-001",
          maxElapsedMs: 600_000,
          fetchImpl: async () =>
            jsonResponse({
              job_id: "job-001",
              status: "failed",
              progress: -1,
              filename: "sample.mp4",
              languageMode: "english",
              error: "provider quota exhausted",
            }),
        }),
      ).rejects.toThrow(/provider quota exhausted/)
    } finally {
      Date.now = originalNow
    }
  })

  test("does not show local timeout while backend keeps running and later fails", async () => {
    const originalNow = Date.now
    let now = 0
    Date.now = () => now
    const responses = [
      {
        job_id: "job-001",
        status: "normalizing",
        progress: 89,
        filename: "sample.mp4",
        languageMode: "english",
        message: "Running caption sync engine.",
        heartbeatAt: "2026-07-05T10:36:30.439675+00:00",
        workerHeartbeatAt: "2026-07-05T10:36:30.439675+00:00",
      },
      {
        job_id: "job-001",
        status: "normalizing",
        progress: 89,
        filename: "sample.mp4",
        languageMode: "english",
        message: "Running caption sync engine.",
        heartbeatAt: "2026-07-05T10:36:45.467000+00:00",
        workerHeartbeatAt: "2026-07-05T10:36:45.467000+00:00",
      },
      {
        job_id: "job-001",
        status: "failed",
        progress: -1,
        filename: "sample.mp4",
        languageMode: "english",
        error:
          "estimated_word_ratio_exceeded: 241 of 246 word(s) use estimated timing (97.97%); maximum is 50.00%.",
      },
    ]
    const seenStatuses: string[] = []
    let thrown: Error | null = null
    try {
      await pollCapinstaJobUntilDone({
        baseUrl: "http://127.0.0.1:8000",
        jobId: "job-001",
        intervalMs: 1,
        maxElapsedMs: 1_000,
        sleep: async () => {
          now += 1_000
        },
        onProgress: (job) => seenStatuses.push(`${job.status}:${job.progress}`),
        fetchImpl: async () => jsonResponse(responses.shift() ?? responses[0]),
      })
    } catch (error) {
      thrown = error as Error
    } finally {
      Date.now = originalNow
    }

    expect(thrown).toBeTruthy()
    expect(thrown?.message).toContain("estimated_word_ratio_exceeded")
    expect(thrown?.message).not.toContain("Timed out waiting")
    expect(seenStatuses).toEqual(["normalizing:89", "normalizing:89"])
  })

  test("does not falsely fail at the old 120 second polling mark by default", async () => {
    const originalNow = Date.now
    const times = [0, 120_000]
    Date.now = () => times.shift() ?? 120_000
    try {
      const result = await pollCapinstaJobUntilDone({
        baseUrl: "http://127.0.0.1:8000",
        jobId: "job-001",
        intervalMs: 0,
        sleep: async () => undefined,
        fetchImpl: async () =>
          jsonResponse({
            job_id: "job-001",
            status: "completed",
            progress: 100,
            filename: "sample.mp4",
            languageMode: "english",
            segments: [{ start: 0, end: 1, text: "Done", words: [] }],
          }),
      })

      expect(result.status).toBe("completed")
    } finally {
      Date.now = originalNow
    }
  })

  test("continues polling after an unknown status", async () => {
    const statuses = ["future_backend_stage", "completed"]
    const result = await pollCapinstaJobUntilDone({
      baseUrl: "http://127.0.0.1:8000",
      jobId: "job-001",
      intervalMs: 1,
      sleep: async () => undefined,
      fetchImpl: async () =>
        jsonResponse({
          job_id: "job-001",
          status: statuses.shift() ?? "completed",
          progress: statuses.length === 0 ? 100 : 50,
          filename: "sample.mp4",
          languageMode: "english",
          segments: [{ start: 0, end: 1, text: "Done", words: [] }],
        }),
    })

    expect(result.status).toBe("completed")
  })

  test("unknown status times out with deduplicated status history", async () => {
    const historySnapshots: string[][] = []
    await expect(
      pollCapinstaJobUntilDone({
        baseUrl: "http://127.0.0.1:8000",
        jobId: "job-001",
        intervalMs: 0,
        maxAttempts: 2,
        maxElapsedMs: 60_000,
        sleep: async () => undefined,
        onStatusHistory: (history) =>
          historySnapshots.push(history.map((entry) => entry.rawStatus)),
        fetchImpl: async () =>
          jsonResponse({
            job_id: "job-001",
            status: "future_backend_stage",
            progress: 55,
            filename: "sample.mp4",
            languageMode: "english",
            details: "A future processing step",
          }),
      }),
    ).rejects.toThrow(/Status history: future_backend_stage\(unknown\) 55%/)

    expect(historySnapshots).toEqual([["future_backend_stage"]])
  })

  test("deduplicates unchanged running statuses but keeps meaningful changes", async () => {
    const historySnapshots: string[][] = []
    const responses = [
      {
        job_id: "job-001",
        status: "transcribing",
        progress: 42,
        filename: "sample.mp4",
        languageMode: "english",
        message: "Transcribing chunk 2 of 2 with Gemini.",
        currentProvider: "gemini",
        currentChunk: 2,
        totalChunks: 2,
      },
      {
        job_id: "job-001",
        status: "transcribing",
        progress: 42,
        filename: "sample.mp4",
        languageMode: "english",
        message: "Transcribing chunk 2 of 2 with Gemini.",
        currentProvider: "gemini",
        currentChunk: 2,
        totalChunks: 2,
      },
      {
        job_id: "job-001",
        status: "transcribing",
        progress: 42,
        filename: "sample.mp4",
        languageMode: "english",
        message: "Gemini timed out; trying Sarvam for chunk 2 of 2.",
        currentProvider: "sarvam",
        currentChunk: 2,
        totalChunks: 2,
      },
    ]

    await expect(
      pollCapinstaJobUntilDone({
        baseUrl: "http://127.0.0.1:8000",
        jobId: "job-001",
        intervalMs: 0,
        maxAttempts: 3,
        maxElapsedMs: 60_000,
        sleep: async () => undefined,
        onStatusHistory: (history) =>
          historySnapshots.push(history.map((entry) => entry.message ?? "")),
        fetchImpl: async () => jsonResponse(responses.shift() ?? responses[0]),
      }),
    ).rejects.toThrow(/Status history:/)

    expect(historySnapshots).toEqual([
      ["Transcribing chunk 2 of 2 with Gemini."],
      [
        "Transcribing chunk 2 of 2 with Gemini.",
        "Gemini timed out; trying Sarvam for chunk 2 of 2.",
      ],
    ])
  })

  test("supports cancellation through AbortSignal", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      pollCapinstaJobUntilDone({
        baseUrl: "http://127.0.0.1:8000",
        jobId: "job-001",
        signal: controller.signal,
        sleep: async () => undefined,
        fetchImpl: async () => {
          throw new Error("fetch should not run")
        },
      }),
    ).rejects.toThrow(/cancelled/)
  })
})
