/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- Public adapter signatures intentionally mirror the Stage 2 integration contract. */
import type {
  CapinstaLanguageMode,
  CapinstaStylePresetMetadataV1,
  CapinstaTimingSource,
  CapinstaTranscriptV1,
  NeutralCaptionClip,
  NeutralCaptionDocument,
  NeutralCaptionWord,
} from "./types"
import type { CapinstaCaptionPresetId } from "./styles/styleTypes"
import { getCapinstaPresetStyle } from "./styles/presetRegistry"
import {
  buildCaptionPages,
  getWordDisplayText,
  normalizeDisplayedCaptionText,
} from "./original/captionUtils"
import {
  getCaptionPresetChunkingConfig,
  isCaptionStylePresetId,
} from "./original/captionStylePresets"
import type {
  AlignedWord,
  CaptionChunkingConfig,
  CaptionStylePresetId as OriginalCaptionStylePresetId,
} from "./original/types"
import { normalizeCapinstaCaptionStyle } from "./styles/styleValidation"

const TRANSCRIPT_VERSION = "capinsta.transcript.v1"
const LANGUAGE_MODES = new Set<CapinstaLanguageMode>([
  "auto",
  "english",
  "hindi",
  "telugu",
  "hinglish",
  "telgish",
  "auto_mixed_indian",
])
const TIMING_SOURCES = new Set<CapinstaTimingSource>([
  "provider",
  "whisperx",
  "stable_ts",
  "vad_adjusted",
  "manual",
  "estimated",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`)
  }
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (!isFiniteNumber(value)) {
    throw new Error(`${path} must be a finite number`)
  }
}

function assertTimeRange(start: unknown, end: unknown, path: string): void {
  assertFiniteNumber(start, `${path}.start`)
  assertFiniteNumber(end, `${path}.end`)
  if (start < 0 || end <= start) {
    throw new Error(`${path} must have a valid non-negative time range`)
  }
}

function uniqueValues(values: string[]): boolean {
  return new Set(values).size === values.length
}

export function validateCapinstaTranscriptV1(input: unknown): CapinstaTranscriptV1 {
  if (!isRecord(input)) {
    throw new Error("transcript must be an object")
  }
  if (input.version !== TRANSCRIPT_VERSION) {
    throw new Error(`transcript.version must be ${TRANSCRIPT_VERSION}`)
  }
  if (!isRecord(input.source)) {
    throw new Error("transcript.source must be an object")
  }
  assertString(input.source.assetId, "transcript.source.assetId")
  assertString(input.source.assetName, "transcript.source.assetName")
  assertFiniteNumber(input.source.durationSeconds, "transcript.source.durationSeconds")
  if (input.source.durationSeconds <= 0) {
    throw new Error("transcript.source.durationSeconds must be greater than 0")
  }
  if (!LANGUAGE_MODES.has(input.languageMode as CapinstaLanguageMode)) {
    throw new Error("transcript.languageMode is unsupported")
  }
  if (!isRecord(input.provider)) {
    throw new Error("transcript.provider must be an object")
  }
  assertString(input.provider.name, "transcript.provider.name")
  if (!Array.isArray(input.clips)) {
    throw new Error("transcript.clips must be an array")
  }
  if (!Array.isArray(input.words)) {
    throw new Error("transcript.words must be an array")
  }
  if (!isRecord(input.stylePreset)) {
    throw new Error("transcript.stylePreset must be an object")
  }
  assertString(input.stylePreset.id, "transcript.stylePreset.id")
  if (!isRecord(input.manualEdits)) {
    throw new Error("transcript.manualEdits must be an object")
  }
  if (!isRecord(input.timing)) {
    throw new Error("transcript.timing must be an object")
  }
  if (input.timing.sourceOfTruth !== "words" && input.timing.sourceOfTruth !== "clips") {
    throw new Error("transcript.timing.sourceOfTruth must be words or clips")
  }
  assertString(input.timing.generatedAt, "transcript.timing.generatedAt")

  const wordIds: string[] = []
  input.words.forEach((word, index) => {
    const path = `transcript.words[${index}]`
    if (!isRecord(word)) throw new Error(`${path} must be an object`)
    assertString(word.id, `${path}.id`)
    assertString(word.text, `${path}.text`)
    assertString(word.displayedText, `${path}.displayedText`)
    assertTimeRange(word.start, word.end, path)
    if (!TIMING_SOURCES.has(word.timingSource as CapinstaTimingSource)) {
      throw new Error(`${path}.timingSource is unsupported`)
    }
    wordIds.push(word.id)
  })
  if (!uniqueValues(wordIds)) {
    throw new Error("transcript.words contains duplicate ids")
  }

  const wordIdSet = new Set(wordIds)
  const clipIds: string[] = []
  input.clips.forEach((clip, index) => {
    const path = `transcript.clips[${index}]`
    if (!isRecord(clip)) throw new Error(`${path} must be an object`)
    assertString(clip.id, `${path}.id`)
    assertString(clip.text, `${path}.text`)
    assertTimeRange(clip.start, clip.end, path)
    if (!Array.isArray(clip.wordIds)) {
      throw new Error(`${path}.wordIds must be an array`)
    }
    clip.wordIds.forEach((wordId, wordIndex) => {
      assertString(wordId, `${path}.wordIds[${wordIndex}]`)
      if (!wordIdSet.has(wordId)) {
        throw new Error(`${path}.wordIds[${wordIndex}] references an unknown word`)
      }
    })
    clipIds.push(clip.id)
  })
  if (!uniqueValues(clipIds)) {
    throw new Error("transcript.clips contains duplicate ids")
  }

  return input as unknown as CapinstaTranscriptV1
}

function documentIdForTranscript(transcript: CapinstaTranscriptV1): string {
  return `capinsta-doc-${transcript.source.assetId}`
}

function trackIdForTranscript(transcript: CapinstaTranscriptV1): string {
  return `capinsta-caption-track-${transcript.source.assetId}`
}

function cloneManualEdits(transcript: CapinstaTranscriptV1) {
  return {
    ...transcript.manualEdits,
    changedClipIds: transcript.manualEdits.changedClipIds
      ? [...transcript.manualEdits.changedClipIds]
      : undefined,
    changedWordIds: transcript.manualEdits.changedWordIds
      ? [...transcript.manualEdits.changedWordIds]
      : undefined,
    notes: transcript.manualEdits.notes ? [...transcript.manualEdits.notes] : undefined,
  }
}

function wordToNeutral(word: CapinstaTranscriptV1["words"][number]): NeutralCaptionWord {
  return {
    id: word.id,
    text: word.text,
    displayedText: word.displayedText,
    start: word.start,
    end: word.end,
    timingSource: word.timingSource,
    originalText: word.originalText,
    spokenText: word.spokenText,
    confidence: word.confidence,
    score: word.score,
    provider: word.provider,
    languageHint: word.languageHint,
    timingSourceDetail: word.timingSourceDetail,
    timingWarning: word.timingWarning,
    timingNeedsReview: word.timingNeedsReview,
    timingRepair: word.timingRepair,
    disableActiveWordHighlighting: word.disableActiveWordHighlighting,
    sourceWordId: word.id,
  }
}

export function buildCapinstaCaptionTimingDiagnostics(
  document: NeutralCaptionDocument,
) {
  const silenceGaps = document.timing.silenceGaps ?? []
  const chunksCrossingSilence = document.clips.flatMap((clip) =>
    silenceGaps
      .filter((gap) => clip.start < gap.end && clip.end > gap.start)
      .map((gap) => ({
        clipId: clip.id,
        text: clip.text,
        start: clip.start,
        end: clip.end,
        silenceStart: gap.start,
        silenceEnd: gap.end,
      })),
  )
  return {
    generatedCaptionChunks: document.clips.map((clip) => ({
      start: clip.start,
      end: clip.end,
      text: clip.text,
    })),
    chunksCrossingSilence,
  }
}

type ResolvedCaptionPresetId = CapinstaCaptionPresetId & OriginalCaptionStylePresetId

function resolvePresetId(
  stylePreset: CapinstaStylePresetMetadataV1,
): ResolvedCaptionPresetId {
  return isCaptionStylePresetId(stylePreset.id)
    ? stylePreset.id
    : "word_highlight_box"
}

function resolveChunkingConfig({
  stylePreset,
}: {
  stylePreset: CapinstaStylePresetMetadataV1;
}): CaptionChunkingConfig {
  const presetId = resolvePresetId(stylePreset);
  return {
    ...getCaptionPresetChunkingConfig(presetId),
    ...(stylePreset.chunkingConfig ?? {}),
  };
}

function neutralWordToAligned(word: NeutralCaptionWord): AlignedWord & { id: string } {
  return {
    id: word.id,
    word: word.text,
    displayedWord: word.displayedText || word.text,
    originalWord: word.originalText || word.text,
    spokenWord: word.spokenText,
    start: word.start,
    end: word.end,
    score: word.score ?? word.confidence ?? 0,
    confidence: word.confidence,
    provider: word.provider,
    timing_source: word.timingSourceDetail ?? word.timingSource,
    timingSource: word.timingSource,
    languageHint: word.languageHint,
    timingWarning: word.timingSourceDetail,
    timing_warning: word.timingSourceDetail,
    timingNeedsReview: word.timingNeedsReview,
    disableActiveWordHighlighting: word.disableActiveWordHighlighting,
  };
}

function buildNeutralClipsWithOriginalChunking({
  transcript,
  words,
  trackId,
  stylePresetId,
  defaultStyle,
  languageMode = transcript.languageMode,
  sourceAssetId = transcript.source.assetId,
  chunkingConfig = resolveChunkingConfig({ stylePreset: transcript.stylePreset }),
}: {
  transcript: CapinstaTranscriptV1;
  words: NeutralCaptionWord[];
  trackId: string;
  stylePresetId: string;
  defaultStyle: ReturnType<typeof getCapinstaPresetStyle>;
  languageMode?: CapinstaLanguageMode;
  sourceAssetId?: string;
  chunkingConfig?: CaptionChunkingConfig;
}): NeutralCaptionClip[] {
  const alignedWords = words
    .map(neutralWordToAligned)
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  if (alignedWords.length === 0) {
    return transcript.clips.map((clip) => ({
      id: clip.id,
      trackId: clip.trackId || trackId,
      start: clip.start,
      end: clip.end,
      text: clip.text,
      wordIds: [...clip.wordIds],
      stylePresetId,
      style: structuredClone(defaultStyle),
      selected: false,
      editable: true,
      manuallyEdited: Boolean(clip.manuallyEdited),
      timingNeedsReview: Boolean(clip.timingNeedsReview),
      timingSource: clip.timingNeedsReview ? "estimated" : "provider",
      disableActiveWordHighlighting:
        Boolean(clip.disableActiveWordHighlighting) || clip.wordIds.length === 0,
      sourceClipId: clip.id,
    }));
  }

  const pages = buildCaptionPages(
    alignedWords,
    chunkingConfig,
  ) as Array<Array<AlignedWord & { id: string }>>;
  const maxHoldAfterWord = Math.max(
    0,
    chunkingConfig.maxHoldAfterWord,
  );

  return pages.map((page, index) => {
    const orderedPage = [...page].sort((left, right) => left.start - right.start || left.end - right.end);
    const firstWord = orderedPage[0]!;
    const lastWord = orderedPage[orderedPage.length - 1]!;
    const nextStart = pages[index + 1]?.[0]?.start;
    const holdWindow = Number.isFinite(nextStart)
      ? Math.max(0, (nextStart as number) - 0.001 - lastWord.end)
      : maxHoldAfterWord;
    const heldEnd = Math.max(
      firstWord.start + 0.04,
      lastWord.end + Math.min(maxHoldAfterWord, holdWindow),
    );
    const nextSilenceStart = transcript.timing.silenceGaps
      ?.filter(
        (gap) =>
          gap.start >= lastWord.end - 0.001 &&
          (!Number.isFinite(nextStart) || gap.start < (nextStart as number)),
      )
      .reduce<number | undefined>(
        (nearest, gap) =>
          nearest === undefined || gap.start < nearest ? gap.start : nearest,
        undefined,
      );
    const end =
      nextSilenceStart === undefined
        ? heldEnd
        : Math.max(firstWord.start + 0.04, Math.min(heldEnd, nextSilenceStart));

    return {
      id: `${sourceAssetId}-capinsta-chunk-${index + 1}`,
      trackId,
      start: Math.round(Math.max(0, firstWord.start) * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
      text: normalizeDisplayedCaptionText(
        orderedPage.map(getWordDisplayText).join(" "),
        languageMode,
      ),
      wordIds: orderedPage.map((word) => word.id),
      stylePresetId,
      style: structuredClone(defaultStyle),
      selected: false,
      editable: true,
      manuallyEdited: false,
      timingNeedsReview: orderedPage.some((word) => Boolean(word.timingNeedsReview)),
      timingSource: orderedPage.some((word) => Boolean(word.timingNeedsReview))
        ? "estimated"
        : "provider",
      disableActiveWordHighlighting: orderedPage.every((word) =>
        Boolean(word.disableActiveWordHighlighting),
      ),
      sourceClipId: orderedPage.map((word) => word.id).join(":"),
    };
  });
}

export function rechunkNeutralCaptionDocumentForPreset({
  document,
  presetId,
}: {
  document: NeutralCaptionDocument;
  presetId: CapinstaCaptionPresetId;
}): NeutralCaptionDocument {
  const stylePreset: CapinstaStylePresetMetadataV1 = {
    id: presetId,
    name: presetId,
    renderer: presetId,
    styleConfig: {},
  };
  const stylePresetId = resolvePresetId(stylePreset);
  const defaultStyle = getCapinstaPresetStyle(stylePresetId);
  const sourceAssetId =
    document.sourceTranscriptRef.sourceAssetId || document.id.replace(/^capinsta-doc-/, "");
  const clips = buildNeutralClipsWithOriginalChunking({
    transcript: {
      version: TRANSCRIPT_VERSION,
      source: {
        assetId: sourceAssetId,
        assetName: document.sourceTranscriptRef.sourceAssetName,
        durationSeconds: document.durationSeconds,
      },
      languageMode: document.languageMode,
      provider: {
        name: document.sourceTranscriptRef.provider,
        fallback: document.sourceTranscriptRef.providerFallback,
        fallbackFrom: document.sourceTranscriptRef.providerFallbackFrom,
      },
      clips: [],
      words: [],
      stylePreset,
      manualEdits: document.manualEdits,
      timing: document.timing,
    },
    words: document.words.map((word) => ({ ...word })),
    trackId: document.trackId,
    stylePresetId,
    defaultStyle,
    languageMode: document.languageMode,
    sourceAssetId,
    chunkingConfig: resolveChunkingConfig({ stylePreset }),
  });

  return {
    ...document,
    stylePresetId,
    style: structuredClone(defaultStyle),
    clips,
    words: document.words.map((word) => ({ ...word })),
  };
}

export function rechunkNeutralCaptionDocumentWithConfig({
  document,
  chunkingConfig,
}: {
  document: NeutralCaptionDocument;
  chunkingConfig: CaptionChunkingConfig;
}): NeutralCaptionDocument {
  const stylePresetId = document.stylePresetId;
  const defaultStyle = document.style ? document.style : getCapinstaPresetStyle(stylePresetId);
  const sourceAssetId =
    document.sourceTranscriptRef.sourceAssetId || document.id.replace(/^capinsta-doc-/, "");

  const clips = buildNeutralClipsWithOriginalChunking({
    transcript: {
      version: TRANSCRIPT_VERSION,
      source: {
        assetId: sourceAssetId,
        assetName: document.sourceTranscriptRef.sourceAssetName,
        durationSeconds: document.durationSeconds,
      },
      languageMode: document.languageMode,
      provider: {
        name: document.sourceTranscriptRef.provider,
        fallback: document.sourceTranscriptRef.providerFallback,
        fallbackFrom: document.sourceTranscriptRef.providerFallbackFrom,
      },
      clips: [],
      words: [],
      stylePreset: {
        id: stylePresetId,
        name: stylePresetId,
        renderer: stylePresetId,
        styleConfig: {},
      },
      manualEdits: document.manualEdits,
      timing: document.timing,
    },
    words: document.words.map((word) => ({ ...word })),
    trackId: document.trackId,
    stylePresetId,
    defaultStyle,
    languageMode: document.languageMode,
    sourceAssetId,
    chunkingConfig,
  });

  const nextStyle = {
    ...defaultStyle,
    chunking: {
      ...(defaultStyle.chunking ?? {}),
      ...chunkingConfig,
    },
  };

  return {
    ...document,
    style: normalizeCapinstaCaptionStyle(nextStyle),
    clips,
    words: document.words.map((word) => ({ ...word })),
  };
}

export function capinstaTranscriptToCaptionDocument(
  transcriptInput: unknown
): NeutralCaptionDocument {
  const transcript = validateCapinstaTranscriptV1(transcriptInput)
  const trackId = trackIdForTranscript(transcript)
  const stylePresetId = resolvePresetId(transcript.stylePreset)
  const defaultStyle = getCapinstaPresetStyle(stylePresetId)
  const words = transcript.words.map(wordToNeutral)
  const clips = buildNeutralClipsWithOriginalChunking({
    transcript,
    words,
    trackId,
    stylePresetId,
    defaultStyle,
  })

  return {
    id: documentIdForTranscript(transcript),
    trackId,
    sourceTranscriptRef: {
      version: transcript.version,
      sourceAssetId: transcript.source.assetId,
      sourceAssetName: transcript.source.assetName,
      provider: transcript.provider.name,
      providerFallback: transcript.provider.fallback,
      providerFallbackFrom: transcript.provider.fallbackFrom,
    },
    durationSeconds: transcript.source.durationSeconds,
    languageMode: transcript.languageMode,
    sourceLanguage: transcript.sourceLanguage,
    detectedLanguage: transcript.detectedLanguage,
    outputLanguage: transcript.outputLanguage,
    transformation: transcript.transformation,
    stylePresetId,
    style: structuredClone(defaultStyle),
    clips,
    words,
    manualEdits: cloneManualEdits(transcript),
    timing: {
      ...transcript.timing,
      silenceGaps: transcript.timing.silenceGaps
        ? transcript.timing.silenceGaps.map((gap) => ({ ...gap }))
        : undefined,
      speechSegments: transcript.timing.speechSegments
        ? transcript.timing.speechSegments.map((segment) => ({ ...segment }))
        : undefined,
      report: transcript.timing.report ? { ...transcript.timing.report } : undefined,
      sync: transcript.timing.sync ? { ...transcript.timing.sync } : undefined,
    },
  }
}

export function getActiveCaptionAtTime(
  document: NeutralCaptionDocument,
  timeSeconds: number
): NeutralCaptionClip | undefined {
  if (!Number.isFinite(timeSeconds)) return undefined
  return document.clips.find((clip) => clip.start <= timeSeconds && timeSeconds < clip.end)
}

export function getActiveWordIdsAtTime(
  document: NeutralCaptionDocument,
  timeSeconds: number
): string[] {
  const activeCaption = getActiveCaptionAtTime(document, timeSeconds)
  if (!activeCaption) return []
  if (activeCaption.disableActiveWordHighlighting) return []
  const activeWordIdSet = new Set(activeCaption.wordIds)
  return document.words
    .filter((word) => activeWordIdSet.has(word.id))
    .filter((word) => !word.disableActiveWordHighlighting)
    .filter((word) => word.start <= timeSeconds && timeSeconds < word.end)
    .map((word) => word.id)
}

function changedClipIds(document: NeutralCaptionDocument, clipId: string): string[] {
  return Array.from(new Set([...(document.manualEdits.changedClipIds || []), clipId]))
}

function changedWordIds(
  document: NeutralCaptionDocument,
  wordIds: string[]
): string[] {
  return Array.from(
    new Set([...(document.manualEdits.changedWordIds || []), ...wordIds])
  )
}

const MANUAL_EDIT_MARKER = "manual_edit_pending_persistence"

export function updateCaptionClipText(
  document: NeutralCaptionDocument,
  clipId: string,
  nextText: string,
  options?: { editedAt?: string }
): NeutralCaptionDocument {
  const editedAt = options?.editedAt ?? MANUAL_EDIT_MARKER
  const targetClip = document.clips.find((clip) => clip.id === clipId)
  if (!targetClip) return document

  const editedWords = nextText.trim().split(/\s+/).filter(Boolean)
  const hasMatchingWordCount = editedWords.length === targetClip.wordIds.length
  const targetWordIds = new Set(targetClip.wordIds)
  const nextClips = document.clips.map<NeutralCaptionClip>((clip) => {
    if (clip.id !== clipId) return { ...clip, wordIds: [...clip.wordIds], manualEdit: clip.manualEdit ? { ...clip.manualEdit } : undefined }
    return {
      ...clip,
      text: nextText,
      wordIds: [...clip.wordIds],
      manuallyEdited: true,
      timingNeedsReview: hasMatchingWordCount
        ? clip.manualEdit?.timingReviewReason === "clip_duration_changed"
        : true,
      manualEdit: {
        ...clip.manualEdit,
        textEditedAt: editedAt,
        originalText: clip.manualEdit?.originalText ?? clip.text,
        timingReviewReason: hasMatchingWordCount
          ? clip.manualEdit?.timingReviewReason === "clip_duration_changed"
            ? "clip_duration_changed"
            : undefined
          : "text_word_count_changed",
      },
    }
  })
  const nextWords = document.words.map<NeutralCaptionWord>((word) => {
    if (!targetWordIds.has(word.id)) return { ...word }
    if (!hasMatchingWordCount) return { ...word }

    const wordIndex = targetClip.wordIds.indexOf(word.id)
    const editedWord = editedWords[wordIndex]
    if (!editedWord) return { ...word }
    return {
      ...word,
      originalText: word.originalText ?? word.displayedText,
      text: editedWord,
      displayedText: editedWord,
      timingNeedsReview: false,
    }
  })

  return {
    ...document,
    clips: nextClips,
    words: nextWords,
    manualEdits: {
      ...document.manualEdits,
      editedAt,
      changedClipIds: changedClipIds(document, clipId),
      changedWordIds: hasMatchingWordCount
        ? changedWordIds(document, targetClip.wordIds)
        : document.manualEdits.changedWordIds
          ? [...document.manualEdits.changedWordIds]
          : undefined,
      notes: hasMatchingWordCount
        ? document.manualEdits.notes
          ? [...document.manualEdits.notes]
          : undefined
        : [
            ...(document.manualEdits.notes || []),
            `Clip ${clipId} word count changed; active-word highlighting disabled until timing is rebuilt.`,
          ],
    },
  }
}

export function updateCaptionClipTiming(
  document: NeutralCaptionDocument,
  clipId: string,
  nextStart: number,
  nextEnd: number,
  options?: { editedAt?: string }
): NeutralCaptionDocument {
  if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || nextStart < 0 || nextEnd <= nextStart) {
    throw new Error("caption clip timing must be a valid non-negative range")
  }

  const targetClip = document.clips.find((clip) => clip.id === clipId)
  if (!targetClip) return document
  const editedAt = options?.editedAt ?? MANUAL_EDIT_MARKER
  const previousDuration = targetClip.end - targetClip.start
  const nextDuration = nextEnd - nextStart
  const durationChanged = Math.abs(previousDuration - nextDuration) > 0.001
  const offset = nextStart - targetClip.start
  const targetWordIds = new Set(targetClip.wordIds)

  const nextClips = document.clips.map<NeutralCaptionClip>((clip) => {
    if (clip.id !== clipId) return { ...clip, wordIds: [...clip.wordIds], manualEdit: clip.manualEdit ? { ...clip.manualEdit } : undefined }
    return {
      ...clip,
      start: nextStart,
      end: nextEnd,
      wordIds: [...clip.wordIds],
      manuallyEdited: true,
      timingSource: "manual" as const,
      timingNeedsReview: durationChanged || clip.timingNeedsReview,
      manualEdit: {
        ...clip.manualEdit,
        timingEditedAt: editedAt,
        originalStart: clip.manualEdit?.originalStart ?? clip.start,
        originalEnd: clip.manualEdit?.originalEnd ?? clip.end,
        timingReviewReason: durationChanged
          ? "clip_duration_changed"
          : clip.manualEdit?.timingReviewReason,
      },
    }
  })
  const nextWords = document.words.map<NeutralCaptionWord>((word) => {
    if (!targetWordIds.has(word.id)) return { ...word }
    if (durationChanged) {
      return {
        ...word,
        timingNeedsReview: true,
        timingSourceDetail:
          "Clip duration changed manually; original word timing preserved.",
      }
    }
    return {
      ...word,
      start: word.start + offset,
      end: word.end + offset,
      timingSource: "manual" as const,
      timingSourceDetail: "Offset with manually moved caption clip.",
      manualOriginalStart: word.manualOriginalStart ?? word.start,
      manualOriginalEnd: word.manualOriginalEnd ?? word.end,
    }
  })

  return {
    ...document,
    clips: nextClips,
    words: nextWords,
    manualEdits: {
      ...document.manualEdits,
      editedAt,
      changedClipIds: changedClipIds(document, clipId),
      changedWordIds: changedWordIds(document, targetClip.wordIds),
      notes: [
        ...(document.manualEdits.notes || []),
        durationChanged
          ? `Clip ${clipId} duration changed; active-word highlighting disabled until timing is rebuilt.`
          : `Clip ${clipId} moved; associated word timings offset by ${offset.toFixed(3)} seconds.`,
      ],
    },
  }
}
