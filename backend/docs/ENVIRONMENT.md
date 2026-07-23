# Environment Variables

Do not commit real `.env` files or API keys.

| Variable | Required | Side | Local Example | Render Example | Purpose |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | Yes | backend/frontend build | `development` | `production` | Runtime mode. Production uses same-origin API and bundled frontend. |
| `HOST` | No | backend | `127.0.0.1` | omit | Local bind host for manual `python server/main.py`. Docker CMD uses `0.0.0.0`. |
| `PORT` | Yes in production | backend | `8000` | Render-provided | HTTP port. Render injects this automatically. |
| `FRONTEND_URL` | No | backend | `http://localhost:3000` | frontend URL if split | Single frontend origin for CORS. |
| `CORS_ORIGINS` | No | backend | `http://localhost:3000,http://127.0.0.1:3000` | frontend URL if split | Comma-separated CORS origins. |
| `NEXT_PUBLIC_API_URL` | No | frontend | blank or `http://127.0.0.1:8000` | blank for single service | Public backend URL. Never set this to localhost in production. |
| `STT_PROVIDER` | Yes for generation | backend | `auto` | `auto` | `auto`, `sarvam`, `openai_whisper`, `groq_whisper`, or `whisper`. |
| `SARVAM_API_KEY` | One provider key required | backend | blank | secret | Sarvam STT key. Recommended for Indian code-mixed speech. |
| `OPENAI_API_KEY` | One provider key required | backend | blank | secret | OpenAI Whisper key. |
| `GROQ_API_KEY` | One provider key required | backend | blank | secret | Groq Whisper key. |
| `MAX_UPLOAD_SIZE_MB` | No | backend | `500` | `500` | Upload size limit. |
| `CAPTION_DURATION_LIMIT_SECONDS` | No | backend | `180` | `180` | Regular-user caption-generation duration limit. Super admins bypass this application policy; technical media limits still apply. |
| `MAX_CONCURRENT_EXPORTS` | No | backend | `1` | `1` | Maximum background MP4 exports running at the same time. Keep `1` on small Render instances. |
| `MAX_EXPORT_DURATION_SECONDS` | No | backend | `300` | `300` | Rejects unexpectedly long exports before Chromium/FFmpeg work starts. |
| `TEMP_DIR` | No | backend | `/tmp/huygen-caps` on Linux, system temp on Windows | `/tmp/huygen-caps` | Runtime temp root. |
| `UPLOAD_DIR` | No | backend | `${TEMP_DIR}/uploads` | `/tmp/huygen-caps/uploads` | Uploaded media storage. |
| `EXPORT_DIR` | No | backend | `${TEMP_DIR}/exports` | `/tmp/huygen-caps/exports` | Exported MP4 storage served at `/exports`. |
| `DB_PATH` | No | backend | `${TEMP_DIR}/database.sqlite` | `/tmp/huygen-caps/database.sqlite` | SQLite job DB. |
| `RUNTIME_CLEANUP_HOURS` | No | backend | `24` | `24` | Best-effort cleanup of old uploads/exports. |
| `MEDIA_DIR` | No | backend | `${TEMP_DIR}/media` | persistent volume path | Project-owned original media asset root. |
| `ABANDONED_UPLOAD_RETENTION_HOURS` | No | backend | `24` | `24` | Maximum age for uploads with no runtime record. |
| `FAILED_EXPORT_RETENTION_HOURS` | No | backend | `6` | `6` | Maximum age for failed/cancelled export artifacts. |
| `DOWNLOAD_ARTIFACT_RETENTION_HOURS` | No | backend | `24` | configurable | Lifetime of completed downloadable exports. |
| `TEMP_AUDIO_RETENTION_HOURS` | No | backend | `6` | `6` | Maximum age for non-active temporary audio. |
| `ORPHAN_SCAN_INTERVAL_SECONDS` | No | backend | `86400` | `86400` | Storage orphan scan interval. |
| `DISK_WARNING_FREE_BYTES` | No | backend | `10737418240` | configurable | Free-space warning threshold. |
| `DISK_REJECT_UPLOAD_FREE_BYTES` | No | backend | `8589934592` | configurable | Reject uploads below this projected free space. |
| `DISK_CRITICAL_FREE_BYTES` | No | backend | `5368709120` | configurable | Reject exports below this projected free space. |
| `RENDER_PAGE_URL` | No | backend export | `http://localhost:3000/render` | omit | Headless render page override. Production uses bundled `/render.html`. |
| `FFMPEG_PATH` | No | backend | `ffmpeg` | omit | Optional explicit local FFmpeg executable. |

## Recommended 50 GB VPS Storage Configuration

Use persistent application-owned directories, not anonymous Docker volumes:

```env
TEMP_DIR=/app/storage/tmp
MEDIA_DIR=/app/storage/media
UPLOAD_DIR=/app/storage/uploads
EXPORT_DIR=/app/storage/exports
CACHE_DIR=/app/storage/cache
DB_PATH=/app/storage/database.sqlite
MAX_UPLOAD_SIZE_MB=500
CAPTION_DURATION_LIMIT_SECONDS=180
MAX_CONCURRENT_EXPORTS=1
ABANDONED_UPLOAD_RETENTION_HOURS=24
FAILED_EXPORT_RETENTION_HOURS=6
DOWNLOAD_ARTIFACT_RETENTION_HOURS=24
TEMP_AUDIO_RETENTION_HOURS=6
ORPHAN_SCAN_INTERVAL_SECONDS=86400
DISK_WARNING_FREE_BYTES=10737418240
DISK_REJECT_UPLOAD_FREE_BYTES=8589934592
DISK_CRITICAL_FREE_BYTES=5368709120
```

For Docker/Coolify, mount one persistent volume into `/app/storage`:

```yaml
volumes:
  - capinsta_storage:/app/storage
```

The container user must be able to create, read, write, rename, and delete files below `/app/storage`. On a host-managed directory, set ownership to the container user or group and use at least `u+rwX,g+rwX` permissions.

`MEDIA_DIR` and `UPLOAD_DIR` may be on different filesystems. Startup will warn about the mismatch, but server-backed caption generation reads `MEDIA_DIR` directly and does not require hardlinks.

Startup checks report missing directories, non-writable directories, root-level unsafe paths, media/upload filesystem mismatch, and invalid disk threshold ordering. Threshold ordering must be:

```text
DISK_WARNING_FREE_BYTES >= DISK_REJECT_UPLOAD_FREE_BYTES >= DISK_CRITICAL_FREE_BYTES
```

## Automatic Storage Retention

The backend runs a retention sweep after startup and repeats every `ORPHAN_SCAN_INTERVAL_SECONDS`. The sweep is single-flight, skips active caption/export jobs, resumes interrupted project deletions, and logs aggregate counts only.

## Manual Production Storage Maintenance

Dry-run is the default:

```bash
cd /app
python scripts/storage_maintenance.py
```

Apply deletion only after reviewing the dry-run:

```bash
cd /app
python scripts/storage_maintenance.py --apply
```

This command reports storage by category, expired temp candidates, Capinsta application storage paths, active-job counts, and before/after disk usage. It does not run Docker system prune and does not delete database files, Supabase data, active exports, or unknown Docker volumes.

## Deleted Project Metadata Migration

Do not rely on project deletion until the retained metadata table exists in Supabase.

Migration file:

```text
apps/web/migrations/0002_deleted_project_records.sql
```

CLI option:

```bash
supabase db push
```

Dashboard option: open Supabase SQL Editor, paste the contents of `apps/web/migrations/0002_deleted_project_records.sql`, and run it once for production.

Backend startup checks for `public.deleted_project_records`. If it is missing, startup logs a warning and project deletion fails closed instead of deleting content without retaining the required admin metadata.

## Production API URL Rule

For the default Docker/Render deployment, leave `NEXT_PUBLIC_API_URL` blank. The browser will call the same origin:

```text
/api/jobs
/api/health
/api/export/jobs
```

If you split frontend and backend, set `NEXT_PUBLIC_API_URL` to the backend Render HTTPS URL and add the frontend URL to backend CORS.

## Secrets

Secret keys are backend-only. Do not use secret keys in `NEXT_PUBLIC_*` variables.
