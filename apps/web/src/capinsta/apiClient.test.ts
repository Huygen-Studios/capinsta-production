/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- Tests inspect FormData boundary objects from mocked fetch calls. */
import { describe, expect, test } from "bun:test"
import {
  checkCapinstaHealth,
  normalizeCapinstaJobToTranscript,
  startCapinstaCaptionJob,
} from "./apiClient"
import type { CapinstaJobDetailResponse } from "./apiTypes"

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

describe("Capinsta API client", () => {
  test("handles health check responses", async () => {
    const health = await checkCapinstaHealth({
      baseUrl: "http://127.0.0.1:8000",
      fetchImpl: async (url) => {
        expect(url).toBe("http://127.0.0.1:8000/health")
        return jsonResponse({ status: "ok", version: "5.0.0" })
      },
    })

    expect(health.status).toBe("ok")
  })

  test("creates caption jobs with expected form fields", async () => {
    const file = new File(["video"], "sample.mp4", { type: "video/mp4" })
    const job = await startCapinstaCaptionJob({
      baseUrl: "http://127.0.0.1:8000",
      file,
      languageMode: "auto_mixed_indian",
      fetchImpl: async (url, init) => {
        expect(url).toBe("http://127.0.0.1:8000/api/jobs")
        expect(init?.method).toBe("POST")
        const body = init?.body
        expect(body).toBeInstanceOf(FormData)
        expect((body as FormData).get("languageMode")).toBe(
          "auto_mixed_indian",
        )
        const uploadedFile = (body as FormData).get("file") as File
        expect(uploadedFile.name).toBe("sample.mp4")
        expect(uploadedFile.type).toBe("video/mp4")
        return jsonResponse({
          job_id: "job-001",
          status: "queued",
          progress: 0,
          filename: "sample.mp4",
          languageMode: "auto_mixed_indian",
        })
      },
    })

    expect(job.job_id).toBe("job-001")
  })

  test("normalizes completed jobs into CapinstaTranscriptV1", () => {
    const job: CapinstaJobDetailResponse = {
      job_id: "job-001",
      status: "completed",
      progress: 100,
      filename: "sample.mp4",
      languageMode: "english",
      transcript: {
        languageMode: "english",
        provider: { name: "sarvam", model: "saaras:v3" },
        segments: [
          {
            id: "seg-1",
            start: 0.2,
            end: 1.3,
            text: "Hello world",
            words: [
              {
                word: "Hello",
                displayedWord: "Hello",
                start: 0.2,
                end: 0.7,
                timingSource: "provider",
              },
              {
                word: "world",
                displayedWord: "world",
                start: 0.75,
                end: 1.3,
                timingSource: "stable_ts",
                timingNeedsReview: true,
              },
            ],
          },
        ],
        metadata: {
          audio: { duration: 2 },
          timing: { source: "test" },
        },
      },
      completed_at: "2026-06-15T00:00:00.000Z",
    }

    const transcript = normalizeCapinstaJobToTranscript({
      job,
      sourceAsset: {
        assetId: "asset-001",
        assetName: "sample.mp4",
        mimeType: "video/mp4",
      },
    })

    expect(transcript.version).toBe("capinsta.transcript.v1")
    expect(transcript.provider.name).toBe("sarvam")
    expect(transcript.clips).toHaveLength(1)
    expect(transcript.words).toHaveLength(2)
    expect(transcript.words[1]?.timingSource).toBe("stable_ts")
    expect(transcript.clips[0]?.timingNeedsReview).toBe(true)
  })
})
