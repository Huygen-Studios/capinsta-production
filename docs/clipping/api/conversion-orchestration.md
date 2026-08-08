# Capinsta conversion orchestration

`POST /clipping/projects/{project_id}/conversion` requires an exact revision
and current EDL. Captions additionally require a current remapped transcript.
It creates or reuses a revision-bound `project_conversion` job.

The HTTP service does not convert project JSON. The job is the boundary for
the Rust-owned converter. No media URL is stored or returned; source-media
attachment remains an explicit later integration step.
# Stage 3.1 execution

Enabled domain-runtime workers now execute `project_conversion` through
`project-bridge` in the Rust CLI. Conversion can only be queued against a
current identity-bearing derivation. The full conversion result remains in the
project cache; the job exposes only a safe bounded summary. Its cache revision
and deterministic result identity are committed atomically with job success.
## Editable project handoff

A current conversion may be handed to Capinsta with
`POST /api/v1/clipping/projects/{projectId}/handoff`. Preparation requires the
exact current revision, target ID and an idempotency key. The resulting
short-lived manifest is claimed, imported, and completed through the handoff
endpoints; it never contains media access URLs. See
`docs/clipping/handoff/handoff-architecture.md`.
