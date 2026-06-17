import type { TProject } from "@/project/types"
import type { CapinstaCaptionDocumentRecord } from "./types"

export function upsertCapinstaCaptionDocument({
  project,
  record,
}: {
  project: TProject
  record: CapinstaCaptionDocumentRecord
}): TProject {
  const existingDocuments = project.capinstaCaptionDocuments ?? []
  const nextDocuments = [
    ...existingDocuments.filter(
      (existingRecord) => existingRecord.document.id !== record.document.id,
    ),
    record,
  ]

  return {
    ...project,
    capinstaCaptionDocuments: nextDocuments,
  }
}

export function getCapinstaCaptionDocuments({
  project,
}: {
  project: Pick<TProject, "capinstaCaptionDocuments">
}): CapinstaCaptionDocumentRecord[] {
  return project.capinstaCaptionDocuments ?? []
}
