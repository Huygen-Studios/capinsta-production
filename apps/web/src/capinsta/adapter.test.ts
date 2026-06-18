import { describe, expect, test } from "bun:test"
import {
  buildCapinstaCaptionTimingDiagnostics,
  capinstaTranscriptToCaptionDocument,
  getActiveCaptionAtTime,
  getActiveWordIdsAtTime,
  updateCaptionClipText,
  updateCaptionClipTiming,
  validateCapinstaTranscriptV1,
} from "./adapter"
import { sampleCapinstaTranscriptV1 } from "./sampleTranscript"

describe("CapinstaTranscriptV1 adapter", () => {
  test("validates the sample transcript", () => {
    expect(validateCapinstaTranscriptV1(sampleCapinstaTranscriptV1)).toBe(sampleCapinstaTranscriptV1)
  })

  test("rejects unsupported transcript versions", () => {
    expect(() =>
      validateCapinstaTranscriptV1({
        ...sampleCapinstaTranscriptV1,
        version: "capinsta.transcript.v0",
      })
    ).toThrow(/version/)
  })

  test("converts a transcript into a neutral caption document", () => {
    const document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1)

    expect(document.id).toBe("capinsta-doc-sample-video-001")
    expect(document.trackId).toBe("capinsta-caption-track-sample-video-001")
    expect(document.clips).toHaveLength(2)
    expect(document.words).toHaveLength(6)
    expect(document.stylePresetId).toBe("word_highlight_box")
    expect(document.sourceTranscriptRef.sourceAssetId).toBe("sample-video-001")
  })

  test("does not mutate the original transcript while converting", () => {
    const before = JSON.stringify(sampleCapinstaTranscriptV1)
    const document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1)

    document.clips[0]!.wordIds.push("new-word")
    document.words[0]!.text = "Changed"

    expect(JSON.stringify(sampleCapinstaTranscriptV1)).toBe(before)
  })

  test("finds the active caption and active word ids by time", () => {
    const document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1)

    expect(getActiveCaptionAtTime(document, 0.5)?.id).toBe(document.clips[0]?.id)
    expect(getActiveWordIdsAtTime(document, 0.5)).toEqual(["word-001"])
    expect(getActiveWordIdsAtTime(document, 1.16)).toEqual(["word-003"])
    expect(getActiveWordIdsAtTime(document, 2.2)).toEqual([])
  })

  test("uses original Capinsta chunking instead of backend segment boundaries", () => {
    const document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1)

    expect(document.clips.map((clip) => clip.text)).toEqual([
      "Build the edit then",
      "captions follow",
    ])
    expect(document.clips[0]?.wordIds).toEqual([
      "word-001",
      "word-002",
      "word-003",
      "word-004",
    ])
    expect(document.clips[1]?.start).toBe(2.78)
  })

  test("uses original MrBeast 1-2 word caption paging", () => {
    const document = capinstaTranscriptToCaptionDocument({
      ...sampleCapinstaTranscriptV1,
      stylePreset: {
        ...sampleCapinstaTranscriptV1.stylePreset,
        id: "mrbeast_style",
        name: "MrBeast Style",
      },
    })

    expect(document.stylePresetId).toBe("mrbeast_style")
    expect(document.clips.map((clip) => clip.text)).toEqual([
      "Build the",
      "edit",
      "then",
      "captions",
      "follow",
    ])
    expect(document.clips.every((clip) => clip.wordIds.length <= 2)).toBe(true)
  })

  test("marks text edits as manual without changing word timing metadata", () => {
    const document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1)
    const clipId = document.clips[0]!.id
    const edited = updateCaptionClipText(document, clipId, "Build the timeline then")
    const editedClip = edited.clips.find((clip) => clip.id === clipId)

    expect(editedClip?.text).toBe("Build the timeline then")
    expect(editedClip?.manuallyEdited).toBe(true)
    expect(editedClip?.manualEdit?.originalText).toBe("Build the edit then")
    expect(edited.manualEdits.changedClipIds).toContain(clipId)
    expect(edited.words.find((word) => word.id === "word-001")?.timingSource).toBe("provider")
    expect(document.clips.find((clip) => clip.id === clipId)?.text).toBe("Build the edit then")
  })

  test("marks duration-changing timing edits for review while preserving word timings", () => {
    const document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1)
    const clipId = document.clips[1]!.id
    const edited = updateCaptionClipTiming(document, clipId, 2.5, 4.8)
    const editedClip = edited.clips.find((clip) => clip.id === clipId)

    expect(editedClip?.start).toBe(2.5)
    expect(editedClip?.end).toBe(4.8)
    expect(editedClip?.timingSource).toBe("manual")
    expect(editedClip?.manualEdit?.originalStart).toBe(2.78)
    expect(editedClip?.manualEdit?.originalEnd).toBe(4.54)
    expect(edited.words.find((word) => word.id === "word-005")?.start).toBe(2.78)
    expect(editedClip?.timingNeedsReview).toBe(true)
    expect(editedClip?.manualEdit?.timingReviewReason).toBe("clip_duration_changed")
    expect(edited.manualEdits.notes?.join(" ")).toMatch(/timing is rebuilt/)
  })

  test("offsets word timings when a clip moves without changing duration", () => {
    const document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1)
    const clip = document.clips[0]!
    const clipId = clip.id
    const duration = clip.end - clip.start
    const edited = updateCaptionClipTiming(document, clipId, 1, 1 + duration)
    const editedClip = edited.clips.find((clip) => clip.id === clipId)
    const editedWord = edited.words.find((word) => word.id === "word-001")

    expect(editedClip?.start).toBe(1)
    expect(editedClip?.end).toBeCloseTo(1 + duration)
    expect(editedClip?.timingNeedsReview).toBe(false)
    expect(editedWord?.start).toBeCloseTo(1)
    expect(editedWord?.end).toBeCloseTo(1.44)
    expect(editedWord?.timingSource).toBe("manual")
  })

  test("builds pause-aware runtime chunks from canonical words", () => {
    const document = capinstaTranscriptToCaptionDocument({
      ...sampleCapinstaTranscriptV1,
      source: {
        ...sampleCapinstaTranscriptV1.source,
        assetId: "pause-runtime",
      },
      clips: [
        {
          id: "source",
          start: 0.5,
          end: 3.2,
          text: "spends around 22 lakh crore",
          wordIds: ["spends", "around", "22", "lakh", "crore"],
        },
      ],
      words: [
        { id: "spends", text: "spends", displayedText: "spends", start: 0.5, end: 0.9, timingSource: "provider" },
        { id: "around", text: "around", displayedText: "around", start: 0.9, end: 1.2, timingSource: "vad_adjusted" },
        { id: "22", text: "22", displayedText: "22", start: 2.4, end: 2.65, timingSource: "vad_adjusted" },
        { id: "lakh", text: "lakh", displayedText: "lakh", start: 2.66, end: 2.9, timingSource: "provider" },
        { id: "crore", text: "crore", displayedText: "crore", start: 2.91, end: 3.2, timingSource: "provider" },
      ],
      timing: {
        ...sampleCapinstaTranscriptV1.timing,
        silenceGaps: [{ start: 1.2, end: 2.4, duration: 1.2 }],
      },
    })
    const diagnostics = buildCapinstaCaptionTimingDiagnostics(document)

    expect(document.clips.map((clip) => clip.text)).toEqual([
      "spends around",
      "22 lakh crore",
    ])
    expect(document.clips[0]?.end).toBeLessThanOrEqual(1.2)
    expect(document.clips[1]?.start).toBe(2.4)
    expect(getActiveWordIdsAtTime(document, 1.8)).toEqual([])
    expect(diagnostics.chunksCrossingSilence).toEqual([])
    expect(diagnostics.generatedCaptionChunks.map((chunk) => chunk.text)).toEqual([
      "spends around",
      "22 lakh crore",
    ])
  })
})
