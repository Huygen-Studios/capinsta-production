# Worker deployment

Deploy the worker separately from FastAPI while reusing the backend image:

```bash
docker compose --profile durable-worker up clipping-worker
```

The profile is off by default. The worker command is:

```bash
python -m server.clipping_jobs.worker
```

In Coolify, create a separate worker service from the backend image, use that
command, provide trusted `ADMIN_DATABASE_URL`, and set
`ENABLE_DURABLE_PROCESSING_WORKER=true`. Do not publish a port. Scale API and
worker replicas independently.

The shared backend image installs FFmpeg/FFprobe at build time. To register the
media handler, also set `ENABLE_MEDIA_PROBE_HANDLER=true`,
`FFPROBE_BINARY=ffprobe`, enable the existing Supabase media-storage
configuration, and provide its service-role secret through Coolify secrets.
Startup runs bounded `ffprobe -version` validation and fails the worker clearly
if the executable is missing or invalid. API processes do not run this check.

SIGINT/SIGTERM stop new claims, signal active handler contexts, wait for the
configured grace period, then cancel remaining in-process tasks. Jobs whose
handlers do not finish remain leased and are recovered after expiry; shutdown
does not falsely mark them successful or cancelled.

With the media handler disabled, the service retains the Task 2.3
polling/recovery-only behavior.

For a media-variant worker, opt in separately:

```env
ENABLE_MEDIA_VARIANT_HANDLERS=true
MEDIA_VARIANT_JOB_TYPES=proxy_generation,audio_extraction,thumbnail_generation,waveform_generation
MEDIA_VARIANT_TEMP_ROOT=/app/storage/media-variants-tmp
PROCESSING_WORKER_MAX_CONCURRENCY=1
```

Use a private volume with enough free space for the configured 2 GiB
per-attempt ceiling plus concurrency. The directory needs no public mount or
port. Supabase service credentials remain backend-only. Graceful shutdown,
leases, and heartbeats terminate active FFmpeg process groups. Initial
transcoding is CPU-only; no GPU is configured.

For a dedicated transcription worker, additionally set:

```env
ENABLE_DURABLE_TRANSCRIPTION_HANDLER=true
TRANSCRIPTION_STORAGE_BACKEND=supabase
TRANSCRIPTION_TEMP_ROOT=/app/storage/transcription-tmp
TRANSCRIPTION_HANDLER_TIMEOUT_SECONDS=3600
TRANSCRIPTION_PROVIDER_TIMEOUT_SECONDS=120
PROCESSING_WORKER_MAX_CONCURRENCY=1
```

Provide the existing active provider configuration and only its server-side
credential. No public port is needed. The service needs outbound HTTPS to the
configured provider and private Storage plus enough ephemeral disk for the
WAV, existing chunks, and bounded intermediate response. Graceful shutdown
terminates the child pipeline and lease loss prevents persistence. Do not
enable this flag on every general worker by default.
# Analysis worker role

Enable with `ENABLE_TRANSCRIPT_ANALYSIS_HANDLERS=true` and select controlled
types through `TRANSCRIPT_ANALYSIS_JOB_TYPES`. A silence role needs FFmpeg,
private Storage credentials, and bounded temporary disk. A transcript-only
role needs PostgreSQL only. Keep automatic planning under its separate,
default-off gate.
# Domain-runtime worker

The shared backend image now contains
`/usr/local/bin/capinsta-clipping-runtime`. A dedicated Coolify worker may
enable the runtime master flag and either handler flag; API and other worker
roles should leave them disabled. No public port is needed. Worker startup
performs real `version` and `health` invocations before claiming supported job
types. See `docs/clipping/runtime/runtime-deployment.md`.
