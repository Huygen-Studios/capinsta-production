# Clipping project API

The authenticated project API is registered at both `/api/v1/clipping/projects`
and the compatibility prefix `/api/clipping/projects`. It is disabled unless
`ENABLE_CLIPPING_PROJECT_API=true`.

`POST /clipping/projects` validates owned, ready media and transcript rows and
atomically creates the authoritative `ClipProjectV1` plus immutable revision
1. With no `initialRanges`, the server creates one full-source enabled range.
Project and initial range IDs are deterministic from actor-scoped idempotency.
Metadata cannot contain local paths, signed URLs, or credentials.

`GET /clipping/projects` uses signed cursor pagination ordered by
`(created_at,id)` descending. `status` and `archived` filters are supported;
the signed cursor is bound to those filters, and deleted rows are hidden.
Project detail returns safe dependency state,
analysis/recommendation counts, and missing/stale/current cache status.

`PATCH /{project_id}` requires `expectedRevision`, validates a complete next
project, appends one immutable `manual` version, and invalidates derived
caches. Only name, canvas, ranges, and metadata are writable.

Archive and delete are idempotent soft lifecycle operations. They preserve
dependencies and history, and reject while a project job is active. Version
lists expose summaries; only the specific-version endpoint returns historical
project JSON.
