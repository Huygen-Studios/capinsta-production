# Clipping export orchestration

Stage 3.3 uses Path B: the existing Capinsta controlled Chromium renderer and
its FFmpeg composition pipeline, driven by the durable PostgreSQL worker.

`ClippingExportRequestV1` accepts only schema version 1, the expected project
revision, the server-owned `vertical-mp4-v1` preset, and captions enabled.
Arbitrary codecs, filters, dimensions, executable paths, Storage locations,
URLs, and renderer code are rejected.

Migration `0024_clipping_preview_exports.sql` adds owner-scoped
`clipping_exports`. A create request reserves the existing idempotency record,
locks a request identity, inserts one export and one `clip_export` processing
job in the same transaction, and reuses an equivalent active or ready export.
The job input stores only durable IDs, revision guards, and SHA-256 identities.

The handler stages are `loading_project`, `resolving_media`,
`preparing_render`, `rendering`, `verifying`, `uploading`, and `finalizing`.
Progress is monotonic through the existing worker heartbeat mechanism.
Finalization re-locks the job, export, project, and media; revalidates every
revision and result identity; then commits export readiness, job success, and
attempt success atomically.

Cancellation of queued work is immediate. Running work enters
`cancel_requested`; FFmpeg observes the worker cancellation event and the
Chromium render task is cancelled, allowing its existing cleanup path to close
the browser and subprocesses. Lease loss cancels the handler and prevents
upload/finalization. Permanent safe failures are recorded without raw renderer
logs, URLs, project JSON, transcript text, or temporary paths.

