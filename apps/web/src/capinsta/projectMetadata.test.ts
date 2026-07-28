import { describe, expect, test } from "bun:test"
import type { TProject } from "@/project/types"
import { sampleCapinstaTranscriptV1 } from "./sampleTranscript"
import {
  capinstaTranscriptToCaptionDocument,
  updateCaptionClipText,
} from "./adapter"
import {
  getCapinstaCaptionDocuments,
  upsertCapinstaCaptionDocument,
} from "./projectMetadata"

function createProject(): TProject {
  return {
    metadata: {
      id: "project-001",
      name: "Project",
      duration: 0,
      createdAt: new Date("2026-06-15T00:00:00.000Z"),
      updatedAt: new Date("2026-06-15T00:00:00.000Z"),
    },
    scenes: [],
    currentSceneId: "",
    settings: {
      fps: { numerator: 30, denominator: 1 },
      canvasSize: { width: 1920, height: 1080 },
      background: { type: "color", color: "#000000" },
    },
    version: 31,
  }
}

describe("Capinsta project metadata", () => {
  test("treats absent Capinsta metadata as backward compatible", () => {
    expect(getCapinstaCaptionDocuments({ project: createProject() })).toEqual([])
  })

  test("keeps optional clipping provenance JSON-serializable", () => {
    const project: TProject = {
      ...createProject(),
      capinstaClippingProvenance: {
        sourceApplication: "clipper",
        sourceClipProjectId: "clip-project-001",
        sourceClipProjectRevision: 3,
        sourceTranscriptId: "transcript-001",
        conversionSchemaVersion: 1,
      },
    }
    const restored = JSON.parse(JSON.stringify(project)) as TProject

    expect(restored.capinstaClippingProvenance).toEqual(
      project.capinstaClippingProvenance,
    )
  })

  test("stores a Capinsta caption document on the project", () => {
    const document = capinstaTranscriptToCaptionDocument(
      sampleCapinstaTranscriptV1,
    )
    const project = upsertCapinstaCaptionDocument({
      project: createProject(),
      record: {
        document,
        openCutTrackId: "track-001",
        importedAt: "2026-06-15T00:00:00.000Z",
      },
    })

    expect(project.capinstaCaptionDocuments).toHaveLength(1)
    expect(project.capinstaCaptionDocuments?.[0]?.document.id).toBe(
      "capinsta-doc-sample-video-001",
    )
    expect(project.capinstaCaptionDocuments?.[0]?.openCutTrackId).toBe(
      "track-001",
    )
  })

  test("survives project JSON serialization", () => {
    const baseDocument = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1)
    const clipId = baseDocument.clips[0]!.id
    const document = updateCaptionClipText(
      baseDocument,
      clipId,
      "Make the clean cut",
      { editedAt: "2026-06-16T10:00:00.000Z" },
    )
    const project = upsertCapinstaCaptionDocument({
      project: createProject(),
      record: {
        document,
        openCutTrackId: "track-001",
        importedAt: "2026-06-15T00:00:00.000Z",
      },
    })
    const restored = JSON.parse(JSON.stringify(project))

    expect(restored.capinstaCaptionDocuments?.[0]?.document.words).toHaveLength(
      6,
    )
    expect(
      restored.capinstaCaptionDocuments?.[0]?.document.words[0]?.timingSource,
    ).toBe("provider")
    expect(
      restored.capinstaCaptionDocuments?.[0]?.document.clips[0]?.text,
    ).toBe("Make the clean cut")
    expect(
      restored.capinstaCaptionDocuments?.[0]?.document.clips[0]?.manuallyEdited,
    ).toBe(true)
    expect(
      restored.capinstaCaptionDocuments?.[0]?.document.manualEdits.editedAt,
    ).toBe("2026-06-16T10:00:00.000Z")
  })

  test("replaces an existing record for the same Capinsta document", () => {
    const document = capinstaTranscriptToCaptionDocument(
      sampleCapinstaTranscriptV1,
    )
    const project = upsertCapinstaCaptionDocument({
      project: upsertCapinstaCaptionDocument({
        project: createProject(),
        record: {
          document,
          openCutTrackId: "track-001",
          importedAt: "2026-06-15T00:00:00.000Z",
        },
      }),
      record: {
        document,
        openCutTrackId: "track-002",
        importedAt: "2026-06-15T00:01:00.000Z",
      },
    })

    expect(project.capinstaCaptionDocuments).toHaveLength(1)
    expect(project.capinstaCaptionDocuments?.[0]?.openCutTrackId).toBe(
      "track-002",
    )
  })
})
