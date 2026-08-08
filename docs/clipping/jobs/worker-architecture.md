# Durable processing worker architecture

PostgreSQL is the sole authority for durable processing-job state. Redis,
Supabase Realtime, browser polling, and process memory are not queues.

The API creates and reads jobs. A separate process started with
`python -m server.clipping_jobs.worker` claims work through
`ProcessingJobLeaseRepository`; the FastAPI lifespan never starts this worker.
The same backend image can therefore be deployed as distinct API and worker
services without creating a worker in every ASGI replica.

`JobHandlerRegistry` maps one job type to one typed handler. The worker claims
only registered types, validates input before execution, transitions the claim
to `running`, supplies a `JobExecutionContext`, validates the returned output,
and atomically records success or failure. Handler code receives callbacks,
not a database connection, and cannot mutate its job row directly.

Task 2.4 adds the first production registration: `media_probe`, gated by
`ENABLE_MEDIA_PROBE_HANDLER`. It uses a narrowly scoped transactional
finalizer so authoritative asset readiness and ordinary job completion commit
together. The worker still owns claiming and validates the finalized output
through the same handler protocol.

`ProcessingWorker` uses bounded concurrency (one by default), one independent
lease/heartbeat per active handler, bounded empty-queue polling, transient
database backoff, and a graceful shutdown deadline.

Worker events use structured key/value logging for identity, state, duration,
and error codes. Claim tokens, inputs, outputs, signed URLs, credentials, and
database URLs are excluded. FFprobe startup logging includes only its bounded
version line.

Task 2.5 adds four opt-in registrations behind
`ENABLE_MEDIA_VARIANT_HANDLERS`. `MEDIA_VARIANT_JOB_TYPES` selects any subset
of proxy, audio extraction, thumbnail, and waveform handlers. Startup validates
FFmpeg and FFprobe once. Probe registration remains independent. Recommended
roles are a probe worker, CPU/disk-bound variant worker, and future
transcription/render workers; one image supports each role through config.

Task 2.6 adds the independent `transcription` registration behind
`ENABLE_DURABLE_TRANSCRIPTION_HANDLER`. It consumes only the current ready
transcription-WAV variant, reuses the existing provider pipeline in a
terminable child process, and atomically finalizes `TranscriptDocumentV2` with
the job and attempt. Probe and variant registrations remain independent, and
workers claim only the types they register.
# Analysis handlers

The opt-in analysis role registers `transcript_analysis` and/or
`silence_analysis` independently. Existing claim, heartbeat, cancellation,
lease, retry, and recovery orchestration remains authoritative. Handlers load
revision-bound dependencies but never claim jobs themselves. Transcript-only
workers do not initialize FFmpeg or Storage.
# Rust domain-runtime handlers

The worker optionally registers `project_derivation` and
`project_conversion`. Registration is independent but requires
`ENABLE_CLIPPING_RUST_RUNTIME`; version and health checks run before claims.
Both handlers invoke a bounded one-shot Rust subprocess and terminate it on
timeout, cancellation, shutdown, or lease loss. Existing probe, variant,
transcription, and analysis handler registration is unchanged.
