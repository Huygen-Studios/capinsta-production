# Deployment

The backend is deployed from the Capinsta monorepo as one Docker web service.
FastAPI serves the protected API and the bundled Next.js `/render.html` artifact
used by the headless export pipeline.

## Docker Build Contract

The backend Dockerfile intentionally needs files from both `backend/` and
`apps/web/`. Always build it with:

```text
Build context: repository root
Dockerfile: backend/Dockerfile
```

Local command:

```powershell
docker build -f backend/Dockerfile -t capinsta-backend .
```

Do not use `backend/` as the Docker build context. Docker will then be unable
to copy `backend/`, `apps/web/`, `package.json`, or `turbo.json`, and the build
will fail before application dependencies are installed.

## Coolify

Create the backend as a Dockerfile application and set:

```text
Base Directory: /
Dockerfile Location: /backend/Dockerfile
Port Exposes: 10000
Health Check Path: /health
```

Do not set Base Directory to `/backend`. After changing either field, redeploy
without build cache once so Coolify does not reuse the invalid build context.

### Small VPS resource safety

The frontend and backend images both run a Next.js production build. On a
single small VPS, do not deploy them concurrently:

```text
Coolify concurrent builds: 1
Deploy order: frontend, then backend
Recommended swap: at least 4 GB
```

The Dockerfiles cap the Next.js compiler heap, but the Coolify concurrency
limit is still required so BuildKit, Bun, Next.js, Python dependencies, and
Playwright/Chromium do not collectively starve the reverse proxy or SSH.

Required authentication/runtime variables include:

```env
NODE_ENV=production
PORT=10000
FRONTEND_URL=https://<YOUR_FRONTEND_DOMAIN>
CORS_ORIGINS=https://<YOUR_FRONTEND_DOMAIN>
SUPABASE_URL=<YOUR_SUPABASE_PROJECT_URL>
SUPABASE_ANON_KEY=<YOUR_SUPABASE_ANON_PUBLIC_KEY>
SUPABASE_SERVICE_ROLE_KEY=<YOUR_SUPABASE_SERVICE_ROLE_KEY>
SUPABASE_JWT_SECRET=<ONLY_IF_LEGACY_HS256_TOKENS_ARE_USED>
```

Keep `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_JWT_SECRET` runtime-only. Do not
make them build arguments or expose them through `NEXT_PUBLIC_*`.

## Render.com

Use `render.yaml` as the blueprint.

Render service details:

- Type: web service
- Runtime: Docker
- Dockerfile: `./backend/Dockerfile`
- Docker context: repository root
- Health check path: `/health`
- Start command: handled by Docker CMD
- Required port behavior: bind to `0.0.0.0:$PORT`

The Docker CMD is:

```sh
uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-10000}
```

## Required Render Env Vars

Set these in the Render dashboard:

```env
NODE_ENV=production
STT_PROVIDER=auto
MAX_UPLOAD_SIZE_MB=500
MAX_CONCURRENT_EXPORTS=1
MAX_EXPORT_DURATION_SECONDS=300
TEMP_DIR=/tmp/huygen-caps
UPLOAD_DIR=/tmp/huygen-caps/uploads
EXPORT_DIR=/tmp/huygen-caps/exports
DB_PATH=/tmp/huygen-caps/database.sqlite
RUNTIME_CLEANUP_HOURS=24
ALIGNMENT_PROVIDER=auto
ENABLE_WHISPERX=false
ENABLE_STABLE_TS=false
ENABLE_SILERO_VAD=false
PAUSE_SPLIT_THRESHOLD=0.30
DEFAULT_GLOBAL_CAPTION_OFFSET=0
```

Set at least one provider key:

```env
SARVAM_API_KEY=
OPENAI_API_KEY=
GROQ_API_KEY=
```

Do not set `NEXT_PUBLIC_API_URL` for the single-service Docker deployment. The frontend will call same-origin `/api/*`, which avoids production browsers calling `localhost` or `127.0.0.1`.

## Separate Frontend/Backend Deployment

Only use a separate frontend service if you intentionally split the app. In that case:

- Backend Render service URL goes into frontend `NEXT_PUBLIC_API_URL`.
- `NEXT_PUBLIC_API_URL` must be an HTTPS backend URL, not localhost.
- Backend `CORS_ORIGINS` must include the frontend URL.
- Backend still binds to `0.0.0.0:$PORT`.

## Health Checks

Render health check:

```text
/health
```

Manual checks:

```text
https://YOUR_RENDER_SERVICE.onrender.com/health
https://YOUR_RENDER_SERVICE.onrender.com/health/export
https://YOUR_RENDER_SERVICE.onrender.com/health/timing
```

`/health/export` may be `degraded` if FFmpeg, FFprobe, Playwright, Chromium, or writable temp/export dirs are unavailable.
`/health/timing` reports WhisperX, stable-ts, Silero VAD, FFmpeg, and FFprobe availability. Optional alignment packages are disabled by default on Render; fallback word timings are marked as `estimated`.

## Common Render Issues

No open ports detected:

- The app is not binding to `0.0.0.0`.
- The app is not using Render's `$PORT`.
- Fix is the Docker CMD already in this repo.

Frontend calls localhost:

- Leave `NEXT_PUBLIC_API_URL` blank for the single Docker service.
- If split deployment, set it to the backend Render HTTPS URL.

Export fails on Render:

- Check `/health/export`.
- Confirm FFmpeg/FFprobe are installed in the Docker image.
- Confirm Chromium launches.
- Confirm `/tmp/huygen-caps/exports` is writable.
- Confirm the UI is using `/api/export/jobs`, not holding a long `/api/jobs/{id}/export` POST open.
- Check `activeExports` and `queuedExports`; keep `MAX_CONCURRENT_EXPORTS=1` on small instances.
- If export reaches frame capture and then Render shows `502`, inspect logs for service restart or memory pressure and reduce duration/resolution/FPS or upgrade the plan.

Ephemeral files disappear:

- Render web service disk is ephemeral.
- Exports are available only while the instance keeps the file.
- Add S3/R2 for durable storage later.
