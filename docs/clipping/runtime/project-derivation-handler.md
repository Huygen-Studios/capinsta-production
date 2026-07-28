# Project derivation handler

`ProjectDerivationJobHandler` executes `project_derivation` jobs. Its durable
input carries IDs and exact project, transcript, and media revisions; large
contracts are loaded from authoritative rows after the lease is validated.
The handler rejects deleted/archived projects, non-ready media/transcripts, and
revision drift before invoking Rust.

Rust returns `EditDecisionListV1` and, when requested,
`RemappedTranscriptV1`. Python validates these contracts but performs no timing
or remapping calculation. Finalization locks the job and dependencies again,
revalidates every revision and provenance relationship, validates the two
caches together, then writes both caches, their revisions, the transcript
revision, and a SHA-256 result identity in the same transaction that succeeds
the job and attempt and clears the lease.

The job output is only a bounded summary of IDs, revisions, counts, duration,
warnings, and result identity. An identical result can replay; a different
identity for the same current revision fails as `derived_result_conflict`.
Any transaction failure rolls back both cache and job state.

