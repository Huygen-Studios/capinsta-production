/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- Fetch response boundaries and Error constructors require narrow adapter casts. */
import type {
  CapinstaHealthResponse,
  CapinstaJobCreateResponse,
  CapinstaJobDetailResponse,
  CapinstaTranscriptNormalizeInput,
  StartCapinstaCaptionJobInput,
} from "./apiTypes"
import type {
  CapinstaLanguageMode,
  CapinstaTimingSource,
  CapinstaTranscriptV1,
} from "./types"
import { validateCapinstaTranscriptV1 } from "./adapter"
import { CAPINSTA_PRESET_IDS } from "./styles/presetRegistry"
import type { CapinstaCaptionPresetId } from "./styles/styleTypes"

export class CapinstaApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "CapinstaApiError"
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      if (typeof body?.detail === "string") detail = body.detail
      else if (typeof body?.message === "string") detail = body.message
    } catch {
      // Keep the status text when the response is not JSON.
    }
    throw new CapinstaApiError(detail || "Capinsta request failed", response.status)
  }
  return (await response.json()) as T
}

export async function checkCapinstaHealth({
  baseUrl,
  fetchImpl = fetch,
  signal,
}: {
  baseUrl: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<CapinstaHealthResponse> {
  if (!baseUrl) throw new CapinstaApiError("Capinsta backend URL is missing")
  const response = await fetchImpl(joinUrl(baseUrl, "/health"), { signal })
  return readJsonResponse<CapinstaHealthResponse>(response)
}

export async function startCapinstaCaptionJob({
  baseUrl,
  file,
  languageMode,
  fetchImpl = fetch,
  signal,
}: StartCapinstaCaptionJobInput & {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<CapinstaJobCreateResponse> {
  if (!baseUrl) throw new CapinstaApiError("Capinsta backend URL is missing")
  const formData = new FormData()
  formData.append("languageMode", languageMode)
  formData.append("file", file)
  console.debug("[Capinsta captions] Upload request", {
    endpoint: "/api/jobs",
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    languageMode,
  })

  const response = await fetchImpl(joinUrl(baseUrl, "/api/jobs"), {
    method: "POST",
    body: formData,
    signal,
  })
  const job = await readJsonResponse<CapinstaJobCreateResponse>(response)
  console.debug("[Capinsta captions] Job creation response", job)
  return job
}

export async function getCapinstaJob({
  baseUrl,
  jobId,
  fetchImpl = fetch,
  signal,
}: {
  baseUrl: string
  jobId: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<CapinstaJobDetailResponse> {
  const response = await fetchImpl(joinUrl(baseUrl, `/api/jobs/${jobId}`), {
    signal,
  })
  const job = await readJsonResponse<CapinstaJobDetailResponse>(response)
  console.debug("[Capinsta captions] Job detail response", {
    jobId,
    status: job.status,
    progress: job.progress,
    error: job.error,
    hasTranscript: Boolean(job.transcript),
    segmentCount: job.transcript?.segments?.length ?? job.segments?.length ?? 0,
  })
  return job
}

export async function cancelCapinstaJob({
  baseUrl,
  jobId,
  fetchImpl = fetch,
}: {
  baseUrl: string
  jobId: string
  fetchImpl?: typeof fetch
}): Promise<CapinstaJobCreateResponse> {
  const response = await fetchImpl(joinUrl(baseUrl, `/api/jobs/${jobId}/cancel`), {
    method: "POST",
  })
  return readJsonResponse<CapinstaJobCreateResponse>(response)
}

function normalizeLanguageMode(value: string | undefined): CapinstaLanguageMode {
  if (
    value === "english" ||
    value === "hinglish" ||
    value === "telgish" ||
    value === "auto_mixed_indian"
  ) {
    return value
  }
  return "auto_mixed_indian"
}

function normalizeTimingSource(value: string | undefined): CapinstaTimingSource {
  if (
    value === "provider" ||
    value === "whisperx" ||
    value === "stable_ts" ||
    value === "vad_adjusted" ||
    value === "manual" ||
    value === "estimated"
  ) {
    return value
  }
  return "estimated"
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function normalizePresetId(value: string | undefined): CapinstaCaptionPresetId {
  return CAPINSTA_PRESET_IDS.includes(value as CapinstaCaptionPresetId)
    ? (value as CapinstaCaptionPresetId)
    : "word_highlight_box"
}

export function normalizeCapinstaJobToTranscript({
  job,
  sourceAsset,
}: CapinstaTranscriptNormalizeInput): CapinstaTranscriptV1 {
  const segments = job.transcript?.segments ?? job.segments ?? []
  if (segments.length === 0) {
    throw new CapinstaApiError("Capinsta job completed without caption segments")
  }

  const words: CapinstaTranscriptV1["words"] = []
  const clips: CapinstaTranscriptV1["clips"] = segments.map((segment, clipIndex) => {
    const clipId = segment.id || `capinsta-clip-${clipIndex + 1}`
    const wordIds: string[] = []
    for (const [wordIndex, word] of (segment.words ?? []).entries()) {
      const text =
        word.word ||
        word.text ||
        word.displayedWord ||
        word.displayWord ||
        word.originalWord ||
        ""
      const start = finiteNumber(word.start) ?? segment.start
      const end = finiteNumber(word.end) ?? start + 0.01
      const wordId = `${clipId}-word-${wordIndex + 1}`
      wordIds.push(wordId)
      words.push({
        id: wordId,
        text,
        displayedText: word.displayedWord || word.displayWord || text,
        start,
        end: end > start ? end : start + 0.01,
        confidence: finiteNumber(word.confidence),
        score: finiteNumber(word.score),
        provider: word.provider,
        timingSource: normalizeTimingSource(word.timingSource || word.timing_source),
        originalText: word.originalWord,
        spokenText: word.spokenWord,
        timingSourceDetail: word.timingSourceDetail,
        timingNeedsReview: Boolean(
          word.timingNeedsReview || word.timingReviewRequired,
        ),
        timingRepair: word.timingRepair || word.timing_repair,
        captionClipId: clipId,
      })
    }

    return {
      id: clipId,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      wordIds,
      timingNeedsReview: wordIds.some((wordId) =>
        words.find((word) => word.id === wordId)?.timingNeedsReview,
      ),
    }
  })

  const providerValue = job.transcript?.provider
  const provider =
    typeof providerValue === "string"
      ? { name: providerValue }
      : {
          name: providerValue?.name || "unknown",
          model: providerValue?.model,
        }
  const maxEnd = Math.max(...clips.map((clip) => clip.end))
  const durationSeconds =
    sourceAsset.durationSeconds ||
    finiteNumber(job.transcript?.metadata?.audio?.duration) ||
    maxEnd

  return validateCapinstaTranscriptV1({
    version: "capinsta.transcript.v1",
    source: {
      assetId: sourceAsset.assetId,
      assetName: sourceAsset.assetName,
      durationSeconds,
      mimeType: sourceAsset.mimeType,
    },
    languageMode: normalizeLanguageMode(job.languageMode || job.target_lang),
    provider,
    clips,
    words,
    stylePreset: {
      id: normalizePresetId(job.transcript?.metadata?.stylePreset?.id as string | undefined),
      name: "Word Highlight Box",
      renderer: "word_highlight_box",
      styleConfig: job.transcript?.metadata?.stylePreset,
    },
    manualEdits: {
      notes: [`Generated from Capinsta job ${job.job_id}.`],
    },
    timing: {
      sourceOfTruth: words.length > 0 ? "words" : "clips",
      generatedAt: job.completed_at || new Date().toISOString(),
      audioDurationSeconds: durationSeconds,
      report: job.transcript?.metadata?.timing,
      sync: job.transcript?.metadata?.sync,
    },
  })
}
