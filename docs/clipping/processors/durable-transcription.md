# Durable transcription

Stage 2.6 adds an opt-in PostgreSQL worker handler for `transcription`. It uses
the current ready `audio_extract` variant with preset
`transcription-wav-16k-mono-v1`, runs the existing Python transcription
pipeline, validates `TranscriptDocumentV2`, and commits the transcript, job,
and attempt terminal state in one transaction. Existing synchronous caption
and export endpoints are unchanged.

## Contracts and identity

`TranscriptionJobInputV1` contains only stable media, storage-object, audio
variant, transcript, configuration, and request-identity values. It rejects
paths, buckets, URLs, credentials, arbitrary models/endpoints/executables,
unknown fields, unsupported options, and unsupported language/provider values.
Hotwords are trimmed, bounded, order-preserving, and case-insensitively
deduplicated.

The SHA-256 request identity covers the media and storage revisions, audio
variant and revision, language mode, controlled provider preference, ordered
hotwords, and supported options. Planning uses a deterministic `tr_` ID derived
from this identity and unique database indexes reuse both transcript and job.
A replacement or material option change creates a different identity rather
than overwriting an older transcript.

`TranscriptionJobResultV1` is a bounded summary: provider/model, requested and
detected language, duration, counts, timing-source summary, sorted warning
codes, and semantic result identity. The full document exists only in
`transcripts.document`; no source, URL, raw response, or transcript duplicate
is stored in job output.

## Execution and lifecycle

The handler validates the active job lease and all authoritative revisions,
then moves the transcript through `queued`, `transcribing`, `normalizing`, and
`ready`. It resolves the trusted variant through `MediaStorage` and copies it
to a root-confined per-attempt workspace. It does not extract audio itself.
Missing, deleted, wrong-preset, non-ready, or stale dependencies fail with
controlled codes.

The existing provider pipeline runs in a spawned child process so timeout,
shutdown, cancellation, or lease loss can terminate it even when a provider
SDK call is blocking. The effective timeout is the minimum of the job,
handler, and configured provider limits. Temporary input, chunks, and bounded
intermediate JSON are removed on every outcome.

Retryable failures remain owned by the job retry policy. A permanent failure,
or retry exhaustion, atomically marks the transcript, job, and attempt failed
with a safe bounded failure. Cancellation releases only the controlled
in-progress transcript state; it never publishes a result.

## Atomic finalization and replay

Finalization re-locks and validates the lease, source revisions, variant,
transcript request identity, and result identity. One transaction writes the
validated V2 document, marks it ready, succeeds the job/attempt, and clears the
lease. A rollback leaves neither side successful. An identical ready result
can replay; a conflicting ready result fails. A stale worker, replaced media,
changed variant, or deleted transcript cannot finalize.

The provider may be called again after a crash before finalization because
external provider idempotency is not assumed. Uniqueness and semantic result
identity still guarantee one authoritative ready transcript.

