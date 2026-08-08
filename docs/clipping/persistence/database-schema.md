# Durable clipping database schema

The authoritative migrations are `0014_clipping_persistence.sql`,
`0015_supabase_media_storage.sql`, `0016_processing_job_leases.sql`,
`0017_media_probe_handler.sql` through
`0021_clipping_project_orchestration.sql` in the existing Drizzle-managed
Supabase/Postgres SQL stream.

| Table | Purpose | Ownership |
| --- | --- | --- |
| `media_assets` | Source media metadata and Storage bucket/path | `owner_user_id` |
| `media_variants` | Future proxy/thumbnail/export metadata | Through `media_assets` |
| `transcripts` | Validated `TranscriptDocumentV2` JSONB | `owner_user_id` |
| `clip_projects` | Authoritative `ClipProjectV1` plus optional derived caches | `owner_user_id` |
| `clip_project_versions` | Small immutable project revision history | Through `clip_projects` |
| `processing_jobs` | Durable job state and typed input/output envelopes | `owner_user_id` |
| `processing_job_attempts` | Internal append-oriented claim/attempt history | Through `processing_jobs` |
| `idempotency_records` | Atomic request reservation and replay | `owner_user_id` |

All user IDs reference `auth.users(id)`. There is no existing team/workspace
membership model, so this stage deliberately does not add one. Ownership
triggers require transcript media, project media/transcript, and job
project/media references to share the same owner.

Durations and contract times use integer milliseconds (`bigint`). Database
timestamps use `timestamptz`. JSONB contract checks require row IDs, media IDs,
schema versions, durations, and revisions to match their documents.

Checks cover media/source kinds, dimensions, sizes, duration, FPS pairs,
portable Storage paths, schema versions, revisions, job types/states,
progress, attempts, and idempotency states. Indexes cover ownership, media
relationships, project updates, queue availability, job type, and idempotency
expiry. `(scope,idempotency_key)` is unique; scopes include the owner identity
when requests are user-owned.

Migration `0016` adds UUID claim tokens, expiring leases, current/last worker
timestamps, retry/failure metadata, cancellation reasons, execution-timeout
policy, claim/lease indexes, and internal attempt history. Browser users retain
owner-scoped read-only access to jobs and receive no access to attempt rows or
worker mutation fields.

Pre-2.3 active rows cannot prove lease ownership. Migration `0016` preserves
them and their prior worker ID, but safely reconciles them to retry-wait,
failed, or cancelled before validating the new lease constraints.

Migration `0017` adds `storage_object_revision`, a deterministic
`probe_result_identity`, an explicit media readiness/deletion status
constraint, and the partial probe-state index. Eligible pre-2.4 queued probe
inputs are backfilled from authoritative asset rows without copying paths or
URLs. Authenticated roles remain read-only for authoritative duration,
dimensions, rational FPS, readiness status, and probe metadata.

Migration `0018` adds source media/storage revisions, canonical generation
specification and SHA-256, result identity, failure, lifecycle timestamps, and
optimistic revision to `media_variants`. A partial unique index prevents two
active rows for one asset/type/source revision/specification. It adds
`thumbnail_generation` and `waveform_generation`, constrains variant
lifecycle, and narrows authenticated SELECT to safe owner-scoped columns.
Browser roles still have no variant write grant.

Migration `0019` adds revision-bound audio source identity, deterministic
request/result identities, failure/ready lifecycle fields, active-request
uniqueness, and lifecycle checks to `transcripts`. Legacy ready transcripts
remain valid with nullable source identity. New durable requests require the
complete media/storage/audio identity tuple. Authenticated users retain
owner-scoped safe reads and no write grant; internal result identity and
failure columns are excluded from their column privileges.

Media/project deletion is soft (`deleted_at`); auth-user deletion cascades
user-owned durable data. Source media is restricted while a project references
it. Derived EDL, remapped transcript, and conversion JSON are caches only;
`project` remains authoritative.
# Transcript analysis persistence

`transcript_analyses` stores revision-bound specifications, lifecycle,
versioned documents, summaries and result identities.
`timeline_recommendations` stores authoritative review proposals. PostgreSQL
triggers require analysis, transcript, media and owner identities to agree.
Authenticated users have owner-scoped read-only access without analysis
failure/result-identity columns; `service_role` owns writes.

# Project orchestration persistence

Migration `0021` records media/transcript dependency revisions and revision
tags for all derived caches. Immutable versions include a controlled source,
transcript revision, and optional derivation identity. Recommendation rows
retain decision audit data. `clip_project_recommendation_consumptions` links
each accepted recommendation to the exact draft revision that consumed it.

The migration adds `project_derivation` as a durable job type. Relationship
triggers enforce owner/project/transcript lineage. Browser roles retain
owner-scoped reads but no orchestration writes.
# Stage 3.1 runtime provenance

Migration `0022_clipping_runtime_results.sql` adds
`latest_derivation_transcript_revision`,
`latest_derivation_result_identity`, and
`latest_conversion_result_identity` to `clip_projects`. Identities are
lowercase SHA-256 hex and may only accompany their required caches/revisions.
Old caches remain structurally readable but are stale until regenerated.
Authenticated browser writes remain revoked; trusted transactional workers
finalize cache and job state together.
