import type { CapinstaCaptionDocumentRecord } from "./types"

const documentsById = new Map<string, CapinstaCaptionDocumentRecord>()

export function rememberCapinstaCaptionDocumentRecord(
  record: CapinstaCaptionDocumentRecord,
): CapinstaCaptionDocumentRecord {
  documentsById.set(record.document.id, record)
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

export function forgetCapinstaCaptionDocument({
  documentId,
}: {
  documentId: string
}): void {
  documentsById.delete(documentId)
}
