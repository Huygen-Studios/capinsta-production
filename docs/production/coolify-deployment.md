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

Before enabling uploads, set Supabase Storage limits:

```text
Storage -> Settings -> Global file size limit
Storage -> source-media -> Edit bucket -> File size limit
```

Both must be at least `MAX_SOURCE_FILE_BYTES` (`2147483648` bytes by default)
for 30-60 minute source videos. The production doctor can verify the bucket
limit, but the project-global Storage limit may remain externally configured
and unverified.

Run the `Production candidate` workflow with `staging` and deploy disabled.
After Linux verification and image smoke tests pass, run it with staging deploy
enabled. The workflow applies additive migrations under a PostgreSQL advisory
lock, triggers Coolify, verifies web/API health, and only then promotes
`latest`.

Workers expose no ports and use concurrency one. The proxy routes API traffic
through the web service. Run a cleanup dry-run and an internal 30–60 minute
upload before changing the admission flags.

Rollback:

```text
CAPINSTA_IMAGE_TAG=<previous-commit-sha> docker compose -f docker-compose.production.yml up -d
```

Additive migrations are not rolled back destructively.
