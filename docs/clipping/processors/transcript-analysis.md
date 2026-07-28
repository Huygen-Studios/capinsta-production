# Durable transcript analysis

Stage 2.7 adds the opt-in `transcript_analysis` worker handler. It loads the
authoritative ready `TranscriptDocumentV2` from PostgreSQL; the job input never
contains transcript content. The version-one input identifies the analysis,
media and transcript revisions, canonical specification hash, controlled
analysis kinds, and `transcript-review-v1` preset.

The output is `TranscriptAnalysisDocumentV1`. Findings retain canonical word
and segment IDs and source-media milliseconds, but do not duplicate transcript
text. Missing timing stays null. Findings and recommendations use SHA-256-based
stable IDs and deterministic ordering. The handler never imports or mutates a
clip project, timeline, EDL, caption, or export model.

Analysis identity includes the media asset/revision, transcript/revision,
analysis type, schema version and canonical specification hash. Equivalent
planning reuses the row and idempotent processing job. A new relevant revision
creates a new identity.

Known limitations: the first preset uses only repository-evidenced filler
tokens, performs no semantic classification, and does not attempt transcript
correction or highlight selection.
