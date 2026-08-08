import { describe, expect, test } from "bun:test"
import { sampleCapinstaTranscriptV1 } from "./sampleTranscript"
import {
  capinstaTranscriptToOpenCutSubtitleImport,
  neutralCaptionDocumentToSubtitleCues,
} from "./opencutClassicAdapter"
import { capinstaTranscriptToCaptionDocument } from "./adapter"

describe("OpenCut Classic Capinsta adapter", () => {
  test("maps the sample transcript into OpenCut subtitle cues", () => {
    const result = capinstaTranscriptToOpenCutSubtitleImport(
      sampleCapinstaTranscriptV1,
    )

    expect(result.document.id).toBe("capinsta-doc-sample-video-001")
    expect(result.captions[0]).toEqual(
      expect.objectContaining({
        text: "Build the edit then",
        startTime: 0.42,
      }),
    )
    expect(result.captions[1]).toEqual(
      expect.objectContaining({
        text: "captions follow",
        startTime: 2.78,
      }),
    )
    expect(result.captions[0]?.duration).toBeCloseTo(2.359)
    expect(result.captions[1]?.duration).toBeCloseTo(1.76)
    expect(result.captions[0]?.style?.color).toBe("#FFFFFF")
    expect(result.source.sourceAssetName).toBe("sample-founder-intro.mp4")
  })

  test("keeps cue timing derived from neutral clips", () => {
    const document = capinstaTranscriptToCaptionDocument(
      sampleCapinstaTranscriptV1,
    )
    const cues = neutralCaptionDocumentToSubtitleCues({ document })

    expect(cues.map((cue) => cue.startTime)).toEqual([0.42, 2.78])
    expect(cues[0]?.duration).toBeCloseTo(2.359)
    expect(cues[1]?.duration).toBeCloseTo(1.76)
  })
})
