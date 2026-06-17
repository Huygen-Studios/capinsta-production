import type { SubtitleCue, SubtitleStyleOverrides } from "@/subtitles/types"
import { capinstaTranscriptToCaptionDocument } from "./adapter"
import type {
  CapinstaTranscriptV1,
  NeutralCaptionClip,
  NeutralCaptionDocument,
} from "./types"

export interface OpenCutClassicCaptionImport {
  document: NeutralCaptionDocument
  captions: SubtitleCue[]
  source: {
    transcriptVersion: CapinstaTranscriptV1["version"]
    transcriptId: string
    sourceAssetId: string
    sourceAssetName: string
  }
}

function readStringStyleValue({
  styleConfig,
  key,
}: {
  styleConfig: Record<string, unknown> | undefined
  key: string
}): string | undefined {
  const value = styleConfig?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function styleForTranscript({
  transcript,
}: {
  transcript: CapinstaTranscriptV1
}): SubtitleStyleOverrides {
  const textColor = readStringStyleValue({
    styleConfig: transcript.stylePreset.styleConfig,
    key: "textColor",
  })

  return {
    color: textColor ?? "#FFFFFF",
    fontWeight: "bold",
    textAlign: "center",
    placement: {
      verticalAlign: "bottom",
      marginVerticalRatio: 0.08,
    },
  }
}

export function neutralCaptionDocumentToSubtitleCues({
  document,
  style,
}: {
  document: NeutralCaptionDocument
  style?: SubtitleStyleOverrides
}): SubtitleCue[] {
  return document.clips.map((clip: NeutralCaptionClip) => ({
    text: clip.text,
    startTime: clip.start,
    duration: clip.end - clip.start,
    style,
  }))
}

export function capinstaTranscriptToOpenCutSubtitleImport(
  transcript: CapinstaTranscriptV1,
): OpenCutClassicCaptionImport {
  const document = capinstaTranscriptToCaptionDocument(transcript)
  const captions = neutralCaptionDocumentToSubtitleCues({
    document,
    style: styleForTranscript({ transcript }),
  })

  return {
    document,
    captions,
    source: {
      transcriptVersion: transcript.version,
      transcriptId: document.id,
      sourceAssetId: transcript.source.assetId,
      sourceAssetName: transcript.source.assetName,
    },
  }
}
