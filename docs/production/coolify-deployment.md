# Coolify deployment

Use the existing Coolify installation and
`docker-compose.production.yml`. It pulls immutable web/backend images from
GHCR; it does not build on the VPS and does not run PostgreSQL or permanent
customer-media volumes.

GitHub environment variables:

```text
APPLICATION_URL
SUPABASE_URL
SUPABASE_ANON_KEY
CAPINSTA_MIGRATION_BASELINE=<latest migration already verified in the target database>
```

GitHub environment secrets:

```text
DATABASE_URL
SUPABASE_SERVICE_ROLE_KEY
COOLIFY_DEPLOY_WEBHOOK
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
ADMIN_SECURITY_PEPPER
INTERNAL_ADMIN_API_SECRET
INTERNAL_MAINTENANCE_SECRET
CAPINSTA_RENDER_TOKEN_SECRET
```

Configure the remaining values from `production.env.example` in Coolify.
Keep all three admission flags `true` for the first deployment. Set exact HTTPS
origins, the private-beta allowlist, and at least one real transcription and
candidate-provider credential.

For production Clipper media, configure Cloudflare R2 on the API and every
backend worker:

```text
CLIPPING_STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=<account-id>
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<server-only-key>
R2_SECRET_ACCESS_KEY=<server-only-secret>
R2_REGION=auto
R2_SOURCE_BUCKET=capinsta-source-media
R2_VARIANTS_BUCKET=capinsta-media-variants
R2_EXPORTS_BUCKET=capinsta-media-exports
R2_MULTIPART_PART_SIZE_BYTES=33554432
R2_MULTIPART_CONCURRENCY=3
R2_MULTIPART_SIGN_BATCH_SIZE=10
R2_PRESIGNED_UPLOAD_TTL_SECONDS=900
R2_PRESIGNED_DOWNLOAD_TTL_SECONDS=900
R2_PRESIGNED_WORKER_TTL_SECONDS=3600
R2_CONNECT_TIMEOUT_SECONDS=10
R2_READ_TIMEOUT_SECONDS=120
R2_MAX_RETRY_ATTEMPTS=5
R2_VERIFY_TLS=true
```

Create those R2 buckets as private buckets. No public bucket, token, signed URL,
or provider key belongs in browser-visible environment variables.

Cloudflare R2 manual setup:

1. Open Cloudflare Dashboard.
2. Select the Huygen/Capinsta Cloudflare account.
3. Open `R2 Object Storage`.
4. Enable R2 if Cloudflare asks.
5. Create private Standard buckets:
   - `capinsta-source-media`
   - `capinsta-media-variants`
   - `capinsta-media-exports`
6. Keep public access disabled and do not connect a public custom domain.
7. Create an R2 API token scoped to object read/write for only those buckets.
8. Copy `Account ID`, `Access Key ID`, and `Secret Access Key`; the secret may
   only be shown once.

Production CORS for all three buckets:

```json
[
  {
    "AllowedOrigins": ["https://capinsta.huygenstudios.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Optional local-development CORS:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Use lifecycle only as a safety net: abort incomplete multipart uploads after
one day where Cloudflare exposes that rule. Application retention remains
authoritative for active source media, variants, and exports.

After deployment, run the read-only production doctor:

```bash
docker exec <api-container-name> python -m server.production.doctor --json
```

After the R2 buckets and credentials are configured, run the explicit R2 write
test once:

```bash
docker exec <api-container-name> python -m server.production.doctor --json --write-test
```

The write test creates one tiny UUID-scoped object, signs a GET URL, deletes
the object, creates one multipart upload, and aborts it. It does not print R2
credentials or signed URLs.

The API and backend workers also share the existing `clipper-workspaces` named
volume for legacy AI-caption media and SQLite metadata:

```text
LEGACY_CAPTION_STORAGE_ROOT=/app/storage/legacy-caption
TEMP_DIR=/app/storage/legacy-caption/tmp
UPLOAD_DIR=/app/storage/legacy-caption/uploads
MEDIA_DIR=/app/storage/legacy-caption/media
EXPORT_DIR=/app/storage/legacy-caption/exports
CACHE_DIR=/app/storage/legacy-caption/cache
DB_PATH=/app/storage/legacy-caption/database.sqlite
MAX_UPLOAD_SIZE_MB=500
DISK_WARNING_FREE_BYTES=1073741824
DISK_REJECT_UPLOAD_FREE_BYTES=268435456
DISK_CRITICAL_FREE_BYTES=134217728
```

These variables belong on the API service and every backend worker service
that creates, reads, exports, cleans up, or diagnoses legacy caption media.
The backend image initializes only `/app/storage/legacy-caption`, preserves
existing files, fixes ownership for the `capinsta` runtime user, then starts
the public API as that non-root user.

If `CLIPPING_STORAGE_PROVIDER=supabase`, set Supabase Storage limits before
enabling uploads:

```text
Storage -> Settings -> Global file size limit
Storage -> source-media -> Edit bucket -> File size limit
```

Both must be at least `MAX_SOURCE_FILE_BYTES` (`2147483648` bytes by default).
R2 mode does not use Supabase Storage for new Clipper uploads, but existing
Supabase-backed media remains readable by its persisted `storage_provider`.

Run the `Production candidate` workflow with `staging` and deploy disabled.
After Linux verification and image smoke tests pass, run it with staging deploy
enabled. The workflow applies additive migrations under a PostgreSQL advisory
lock, triggers Coolify, verifies web/API health, and only then promotes
`latest`.

Workers expose no ports and use concurrency one. The proxy routes API traffic
through the web service. Run a cleanup dry-run and an internal 30–60 minute
upload before changing the admission flags.

## Editor export worker

Editor exports are queued in `processing_jobs`; the API only validates and
enqueues them. The dedicated export worker runs both Clipper exports and the
Remotion hybrid editor exporter from the same immutable backend image as the
API. Keep these production values on that worker:

```text
CAPINSTA_EXPORT_ENGINE=remotion_hybrid
ENABLE_EDITOR_EXPORT_HANDLER=true
PROCESSING_WORKER_REQUIRED_JOB_TYPES=clip_export,editor_export
PROCESSING_WORKER_MAX_CONCURRENCY=1
CAPINSTA_REMOTION_TEMP_ROOT=/tmp/capinsta-remotion-export
```

Apply migration `0033_editor_export_jobs.sql` before starting the new worker.
Deploy one commit-SHA image to the API and all workers, then verify a normal
video export, a caption export, a solid-background export, and cancellation.
The completed file remains available through the existing scoped download URL.

To roll back new editor jobs without changing the API contract, set
`CAPINSTA_EXPORT_ENGINE=legacy` on the API and export worker and restart both.
Already-running Remotion jobs finish on the worker that claimed them; do not
delete `processing_jobs` rows or the shared legacy-caption volume.

Rollback:

```text
CAPINSTA_IMAGE_TAG=<previous-commit-sha> docker compose -f docker-compose.production.yml up -d
```

Additive migrations are not rolled back destructively.
