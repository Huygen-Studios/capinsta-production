# Stage 2 tracking

## Task 2.1 — Durable Supabase clipping persistence

Status: complete.

Audit findings:

- Supabase Auth and `supabase-js` SSR/browser clients already exist.
- FastAPI verifies Supabase JWTs and uses direct `psycopg` for transactional
  Postgres operations; it has no Python Supabase client.
- The web server has a server-only service-role client.
- Drizzle SQL migrations are the authoritative Supabase/Postgres migration
  mechanism. Existing migrations already manage RLS, `auth.users` integration,
  and the private `capinsta-media` bucket/policies.
- Caption/export execution remains local-filesystem plus SQLite, with an
  operational Postgres mirror. No existing workspace membership model exists.

Task 2.1 adds migration `0014`, seven durable tables, same-owner relationship
triggers, read-only browser RLS, Stage 1 contract validation, typed job inputs,
five repositories, optimistic revisions, explicit job transitions, atomic
idempotency, focused tests, and the disabled-by-default
`ENABLE_SUPABASE_DURABLE_JOBS` flag.

Known limitations and follow-ups:

- No existing endpoint constructs these repositories yet; execution remains
  unchanged by design.
- Storage uploads, private signed URLs, resumable transfers, and durable media
  attachment are Task 2.2.
- Workspace/team ownership is deferred until a real membership model exists.
- Job claiming, workers, Realtime publication, cleanup, and SQLite backfill are
  not part of Task 2.1.

Verification on 2026-07-25:

- Supabase CLI: unavailable; the repository has no Supabase CLI project.
- Disposable PostgreSQL 17 Docker validation: passed. The real migration
  applied from empty schemas; catalog, constraint, index, trigger, RLS, anon,
  two-user, and service-role checks passed.
- Focused persistence tests: 7 passed.
- Existing Stage 1 contract, caption lifecycle/idempotency, auth ownership, and
  SQLite export-locking tests: 49 passed.
- Existing request-validation, export-route, and storage-lifecycle tests:
  12 passed.
- Web project migrations/storage regressions with the repository WASM preload:
  116 passed, 1 pre-existing failure. `shouldPersistMediaFileInBrowser` returns
  `true` for a server-backed asset while its existing test expects `false`;
  Task 2.1 does not modify that function. A first run without the preload also
  hit the known Bun/WASM bootstrap error and was superseded by this run.
- `python -m compileall -q backend`: passed. The initially requested non-quiet
  form reached all new modules but the Windows console could not print one
  pre-existing Unicode artifact path; quiet mode completed successfully.
- Web `bun x tsc --noEmit`: passed.
- `git diff --check`: passed (line-ending conversion warnings only).
- Rust was not run because Task 2.1 did not modify Stage 1 Rust integration.

## Task 2.2 — Supabase media storage

Status: implementation complete; provider-level verification unavailable.

- Added migration `0015_supabase_media_storage.sql`, private `source-media`,
  `media-variants`, and `media-exports` buckets, source-object RLS, and durable
  `media_upload_sessions`.
- Selected direct signed Supabase TUS with server-chosen, MIME-derived,
  versioned paths. FastAPI verifies object metadata before attachment.
- Added `MediaStorage`, `SupabaseMediaStorage`, explicit `LocalMediaStorage`,
  transactional repositories/services, and authenticated `/api[/v1]/clipping/media`
  upload, status, completion, preview, download, and deletion endpoints.
- Replacement keeps the old object active until atomic path switch. Deletion
  is idempotent and recoverable. Signed URLs/tokens are never stored.
- New behavior is off by default with `ENABLE_SUPABASE_MEDIA_STORAGE=false`;
  existing local caption/export upload flows are unchanged.
- Fixed the directly related browser baseline defect:
  server-backed assets no longer duplicate their media bytes into OPFS/IndexedDB.
- Worker claiming/execution, probing execution, variant generation, cleanup
  scheduling, quotas, and UI integration remain deferred.

Verification details and any environment skips are recorded in the Task 2.2
completion report.

## Task 2.3 — Durable processing-job orchestration

Status: implemented; final verification recorded in the completion report.

- Migration `0016` adds claim tokens, leases, retry/failure metadata, optimized
  claim/recovery indexes, and append-oriented `processing_job_attempts`.
- Claims use deterministic `FOR UPDATE SKIP LOCKED` ordering and increment the
  attempt atomically. Every active mutation verifies worker, token, and lease.
- Heartbeats extend leases and report monotonic coarse progress. Atomic success
  and failure clear ownership. Retry timestamps and bounded backoff are durable.
- Advisory-lock recovery handles expired leases and promotes eligible retries.
  Queued cancellation is immediate; active cancellation is cooperative.
- Added a typed handler registry, bounded worker loop, structured events,
  graceful shutdown, and separate `durable-worker` Docker profile.
- `ENABLE_DURABLE_PROCESSING_WORKER=false` remains the default. FastAPI and the
  existing SQLite caption/export workers are unchanged.
- Actual media probing, FFmpeg, transcription, analysis, conversion, and export
  handlers remain deferred.

## Task 2.4 — Durable media probing

Status: implemented and verified.

- Added strict `MediaProbeJobInputV1` and `MediaProbeResultV1` contracts.
- Added provider-neutral local-path and ephemeral-HTTPS probe sources.
- Added a fixed-argument, no-shell FFprobe runner with protocol allow-lists,
  bounded output, hard timeout, cancellation/lease-loss termination, and URL
  redaction.
- Added deterministic duration, rational FPS, rotation, display-dimension,
  stream-selection, audio-only, MIME-warning, and bounded metadata
  normalization.
- Migration `0017` adds storage-object revision, probe identity, readiness
  lifecycle validation, revision-guard backfill, and explicit read-only
  browser permissions.
- Successful asset metadata and job/attempt completion use one PostgreSQL
  transaction. Permanent failure is also atomic. Crash rollback, stale
  replacement, lease recovery, cancellation, and RLS have real PostgreSQL 17
  coverage.
- Handler registration remains off by default with
  `ENABLE_MEDIA_PROBE_HANDLER=false`. The existing backend image already
  contains FFprobe; enabled workers validate it at startup.
- Real local FFprobe verification covers synthetic WAV, video with audio,
  video without audio, and malformed media. Rotation parsing uses synthetic
  FFprobe JSON because container rotation metadata is encoder/container
  dependent.
- Real Supabase network probing was not executed; the Supabase adapter and URL
  security path use mocked/provider-neutral tests.

Deferred to Task 2.5: proxy video, extracted audio, thumbnails, waveforms, and
durable media variants.

## Task 2.5 — Durable media variants

Status: implemented; verification details are recorded in the completion
report.

- Migration `0018` adds revision/spec identities, lifecycle/failure fields,
  uniqueness, safe browser projection, private object reads, and thumbnail/
  waveform job types.
- `MediaVariantPlanningService` atomically creates or reuses variants and jobs
  using the current successful probe result.
- Opt-in handlers generate and verify editing MP4, 16 kHz mono WAV, poster
  JPEG, and bounded min/max waveform JSON.
- A fixed-argument FFmpeg runner provides bounded progress/stderr, timeout,
  cancellation, lease-loss/shutdown termination, and URL redaction.
- Trusted Storage upload uses deterministic private paths and safe identical
  replay; variant readiness and job success finalize atomically.
- Existing caption/export, transcription routing, VAD, UI, and rendering paths
  remain unchanged.

Known limitations: Supabase checksum availability controls whether a
post-upload crash can reuse an existing remote object; otherwise it fails
safely. Automatic orphan/stale-temp scheduling and use of extracted WAV as a
waveform soft dependency remain follow-up work.

## Task 2.6 — Durable transcription

Status: complete and verified; final verification details are recorded in the
completion report.

- Added strict versioned transcription input and bounded result contracts,
  deterministic request/result identities, and an idempotent planner.
- Added an opt-in handler that consumes the current ready transcription WAV,
  invokes the existing provider/router/normalization/timing pipeline in a
  terminable process, and produces validated `TranscriptDocumentV2`.
- Migration `0019` adds the transcript lifecycle and revision-bound source
  identity. Transcript, job, and attempt success/failure finalize atomically.
- Added bounded source materialization, cancellation/lease-loss/timeout
  controls, deterministic warnings, safe failure classification, and
  owner-scoped read-only transcript permissions.
- Existing synchronous captions, caption word spacing, rendering, export,
  VAD, and provider routing remain unchanged.

Known limitations: hotwords are validated but warned as unsupported because
the existing adapters lack one uniform provider-neutral capability; speaker
labels and confidence remain absent when providers omit them; a crash before
atomic finalization can repeat an external provider call because provider
idempotency is not assumed. Live provider and Supabase smoke verification
require explicit development credentials.

Follow-up: Stage 2, Task 2.7 should add transcript-analysis handlers for
silence, filler words, confidence review, and deterministic timeline
recommendations without directly editing `ClipProjectV1`.
# Task 2.7 — durable transcript analysis

Status: implemented; verification recorded in the Task 2.7 completion report.

Added migration `0020_transcript_analysis.sql`, versioned analysis/job/result
contracts, deterministic presets and identities, analysis planning, atomic
persistence, silence and transcript-review handlers, proposal persistence,
worker registration, tests, and processor documentation.

Follow-up: Task 2.8 should add authenticated orchestration APIs and derive
draft projects only from explicitly accepted proposals. Known risks are the
intentionally small evidence-backed filler dictionary and FFmpeg acoustic
silence being advisory rather than proof that speech is absent.

## Task 2.8 — authenticated project orchestration

Status: complete.

Migration `0021` adds revision provenance, recommendation decision audit,
consumption rows, and `project_derivation`. Authenticated dual-prefix APIs
create/list/read/update/archive projects, expose versions/recommendations,
persist atomic decisions, derive deterministic accepted-only drafts, enqueue
Rust-owned derivation/conversion work, and report safe status.

Draft subtraction preserves manual gaps, disabled ranges, ordering, playback
rates, and unaffected IDs. Derived caches are revision-bound and invalidated
by changes. The runtime bridge remains deferred: durable jobs are tested, but
no Python/TypeScript Rust algorithm duplicate was introduced. Decision reset
is deferred until consumed-draft supersession is defined.

Verification on 2026-07-25 includes focused pure/API tests and disposable
PostgreSQL 17 concurrency, rollback, provenance, and two-user RLS tests.

**Stage 2 complete.**
