# Derived-data orchestration

`POST /clipping/projects/{project_id}/derive` validates exact current project,
media, and transcript revisions and creates or reuses a durable
`project_derivation` job. The versioned input records all dependencies and a
canonical identity.

Python does not generate EDL timing or remap transcripts. Stage 3 must invoke
the authoritative Rust engines and atomically persist validated outputs with
matching cache-revision columns. Until then, job status is explicit.

`GET /{project_id}/status` combines safe dependency, analysis,
recommendation, job, and cache state. `GET /{project_id}/jobs/{job_id}` returns
a safe owner-scoped derivation or conversion job.
# Stage 3.1 execution

Enabled domain-runtime workers now execute queued `project_derivation` jobs
through the Rust clipping runtime. The job input includes
`expectedMediaRevision` in addition to exact project/transcript revisions.
Finalization persists EDL and remapped-transcript caches with a derivation
result identity and transcript revision in the same transaction that succeeds
the job. Status treats legacy caches without that identity as stale.
