# TranscriptDocumentV2

`contracts/transcript-document-v2.schema.json` is the canonical, JSON Schema 2020-12 source of truth for the provider-neutral transcript boundary. It uses camelCase and integer milliseconds everywhere; seconds remain confined to legacy adapters.

The required document identity fields are `schemaVersion: 2`, `transcriptId`, `mediaId`, duration, language fields, provider, all entity arrays, quality, metadata, and ISO-8601 creation/update timestamps. Provider `model`, `requestId`, and all metadata are optional in meaning (represented as null or `{}`), so frontend features must not depend on them.

Segments and words keep user-visible `text` separate from immutable provider `originalText`. A text edit therefore does not alter the original provider string or require a timing edit. Word timestamps are either both integer milliseconds or both null; conversion never estimates missing times. Timing provenance is one of `provider`, `aligned`, `interpolated`, `estimated`, `manuallyAdjusted`, or `unknown`.

IDs are stable per persisted document. The production-normalized compatibility adapter uses existing IDs, otherwise `seg_000001` and `word_000001` in source order. Those fallback IDs are stable for an unchanged input but can shift after insertion or deletion; durable provider IDs should be supplied for stronger stability.

Validation rejects version, negative/out-of-range times, reversed ranges, duplicate IDs, unresolved word/segment/speaker references, duplicate segment word references, and confidences outside 0–1. Empty and segment-only documents are valid. Segment overlap is valid (including same-speaker overlap) for compatibility with current production output; consumers may surface `quality.warnings` and `overlapCount`.

Python's `to_transcript_document_v2` converts existing seconds-based normalized pipeline responses without changing responses or routing. The shared TypeScript package exposes runtime validation and a narrow seconds-based legacy segment adapter. Rust provides serialization plus explicit `validate()`. These representations are intentionally derived from the schema pending a schema-codegen toolchain; any schema change must update the Python model, TypeScript package, Rust crate, and cross-language fixture tests together.

Future versions must add a new schema version and a migration adapter rather than reinterpret V2 fields. V2 does not yet persist clip ranges, highlight decisions, VAD execution results, or export mappings.

```json
{"schemaVersion":2,"transcriptId":"tr_001","mediaId":"media_001","durationMs":1200,"languageMode":"auto","detectedLanguages":["en"],"provider":{"name":"sarvam","model":null,"requestId":null,"metadata":{}},"segments":[],"words":[],"speakers":[],"silenceRegions":[],"quality":{"overallScore":null,"timingScore":null,"confidenceScore":null,"lowConfidenceWordCount":0,"untimedWordCount":0,"overlapCount":0,"warnings":[]},"metadata":{},"createdAt":"2026-07-24T12:00:00Z","updatedAt":"2026-07-24T12:00:00Z"}
```
