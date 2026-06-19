/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- Tests inspect FormData boundary objects from mocked fetch calls. */
import { describe, expect, test } from "bun:test"
import {
  checkCapinstaHealth,
  normalizeCapinstaJobToTranscript,
  sendCapinstaProjectHeartbeat,
  startCapinstaCaptionJob,
} from "./apiClient"
import type { CapinstaJobDetailResponse } from "./apiTypes"
import { capinstaTranscriptToCaptionDocument } from "./adapter"

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

  test("renews the backend project lease", async () => {
    const lease = await sendCapinstaProjectHeartbeat({
      baseUrl: "http://127.0.0.1:8000",
      jobId: "job-001",
      fetchImpl: async (url, init) => {
        expect(url).toBe("http://127.0.0.1:8000/api/jobs/job-001/heartbeat")
        expect(init?.method).toBe("POST")
        return jsonResponse({
          job_id: "job-001",
          last_seen_at: "2026-06-19T10:00:00+00:00",
          expires_at: "2026-06-19T10:15:00+00:00",
        })
      },
    })

    expect(lease.expires_at).toBe("2026-06-19T10:15:00+00:00")
  })

  test("prefers canonical alignedWords without redistributing pause timing", () => {
    const job: CapinstaJobDetailResponse = {
      job_id: "job-pause",
      status: "completed",
      progress: 100,
      filename: "pause.mp4",
      languageMode: "english",
      transcript: {
        languageMode: "english",
        provider: "sarvam",
        alignedWords: [
          {
            word: "spends",
            displayedWord: "spends",
            originalWord: "spends",
            spokenWord: "spends",
            start: 0.5,
            end: 0.9,
            timing_source: "provider_word",
          },
          {
            word: "around",
            displayedWord: "around",
            start: 0.9,
            end: 1.2,
            timingSource: "vad_adjusted",
            timingSourceDetail: "provider_word | pause_preserved",
          },
          {
            word: "22",
            displayedWord: "22",
            start: 2.4,
            end: 2.65,
            timing_source: "pause_preserved",
            timingWarning: "Adjusted to detected speech after silence.",
          },
          { word: "lakh", displayedWord: "lakh", start: 2.66, end: 2.9 },
          { word: "crore", displayedWord: "crore", start: 2.91, end: 3.2 },
        ],
        segments: [
          {
            id: "compressed-segment",
            start: 0.5,
            end: 3.2,
            text: "spends around 22 lakh crore",
            words: [
              { word: "spends", start: 0.5, end: 1.0 },
              { word: "around", start: 1.0, end: 1.5 },
              { word: "22", start: 1.5, end: 1.8 },
              { word: "lakh", start: 1.8, end: 2.1 },
              { word: "crore", start: 2.1, end: 2.4 },
            ],
          },
        ],
        metadata: {
          audio: { duration: 3.5 },
          timing: {
            vad: {
              silenceGaps: [{ start: 1.2, end: 2.4, duration: 1.2 }],
            },
          },
          sync: {
            pausePreservation: {
              pauseGapsApplied: 1,
              wordsShiftedForPause: 3,
              wordsClampedForPause: 0,
            },
          },
        },
      },
    }

    const transcript = normalizeCapinstaJobToTranscript({
      job,
      sourceAsset: {
        assetId: "asset-pause",
        assetName: "pause.mp4",
        mimeType: "video/mp4",
      },
    })

    expect(transcript.words.map((word) => word.start)).toEqual([
      0.5,
      0.9,
      2.4,
      2.66,
      2.91,
    ])
    expect(transcript.words[1]?.timingSourceDetail).toBe(
      "provider_word | pause_preserved",
    )
    expect(transcript.words[2]?.timingWarning).toBe(
      "Adjusted to detected speech after silence.",
    )
    expect(transcript.timing.silenceGaps).toEqual([
      { start: 1.2, end: 2.4, duration: 1.2 },
    ])
    expect(transcript.timing.sync?.pausePreservation).toEqual({
      pauseGapsApplied: 1,
      wordsShiftedForPause: 3,
      wordsClampedForPause: 0,
    })
    const document = capinstaTranscriptToCaptionDocument(transcript)
    expect(document.clips.map((clip) => clip.text)).toEqual([
      "spends around",
      "22 lakh crore",
    ])
  })
})
