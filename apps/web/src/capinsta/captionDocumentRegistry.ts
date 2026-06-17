import type {
  CapinstaCaptionDocumentRecord,
  NeutralCaptionDocument,
} from "./types"

const documentsById = new Map<string, CapinstaCaptionDocumentRecord>()

export function rememberCapinstaCaptionDocument({
  document,
  openCutTrackId,
}: {
  document: NeutralCaptionDocument
  openCutTrackId: string
}): CapinstaCaptionDocumentRecord {
  const record = {
    document,
    openCutTrackId,
    importedAt: new Date().toISOString(),
  }
  documentsById.set(document.id, record)
  return record
}

export function getCapinstaCaptionDocument({
  documentId,
}: {
  documentId: string
}): CapinstaCaptionDocumentRecord | undefined {
  return documentsById.get(documentId)
}

export function listCapinstaCaptionDocuments(): CapinstaCaptionDocumentRecord[] {
  return Array.from(documentsById.values())
}
