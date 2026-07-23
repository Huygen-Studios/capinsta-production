# Docker

`backend/Dockerfile` builds and runs the production backend/exporter. The
Next.js web service is deployed separately and exposes the authenticated
`/render` route used by the worker.

## What The Dockerfile Does

1. Uses Python 3.11 slim for the runtime image.
2. Installs FFmpeg, FFprobe, Chromium dependencies, and Python requirements.
3. Installs the Playwright Chromium headless shell.
4. Starts FastAPI on `0.0.0.0:$PORT`.

No dev servers are used in production.

## Build

```powershell
docker build -f backend/Dockerfile -t capinsta-backend .
```

## Run

```powershell
docker run --rm --env-file backend/.env -e NODE_ENV=production -e PORT=10000 -p 10000:10000 capinsta-backend
```

Open:

```text
http://localhost:10000
http://localhost:10000/health
http://localhost:10000/health/export
```

## Docker Compose

```powershell
docker compose -f backend/docker-compose.yml up --build
```

The compose service maps host port `10000` to container port `10000` and sets `/tmp/huygen-caps` runtime paths.

## Logs

```powershell
docker logs <container-id>
docker compose logs -f
```

## Env File

The local `docker-compose.yml` uses `.env`. Keep `.env` local and out of Git.

Required for real caption generation:

- `STT_PROVIDER`
- one of `SARVAM_API_KEY`, `OPENAI_API_KEY`, or `GROQ_API_KEY`

Required for export:

- `CAPINSTA_RENDER_BASE_URL` or `RENDER_PAGE_URL` pointing to the web service,
- the same strong `CAPINSTA_RENDER_TOKEN_SECRET` in web and backend,
- writable `TEMP_DIR` and `EXPORT_DIR`,
- optional explicit `FFMPEG_PATH` and `FFPROBE_PATH`.

## Troubleshooting

If `/health` fails:

- The app did not start.
- The container is not bound to the mapped port.
- Check logs for dependency import errors.

If `/health/export` is degraded:

- Confirm FFmpeg and FFprobe are installed.
- Confirm Playwright Chromium installed and can launch.
- Confirm `/tmp/huygen-caps` is writable.
- Confirm `render_page_reachable` and `render_contract_ready` are true.
- Confirm the web and backend services share `CAPINSTA_RENDER_TOKEN_SECRET`.

If MP4 export is slow:

- The default CPU encoder is `libx264`.
- Render free/starter instances may be slow for long videos.
- Keep test exports short while validating deployment.
- Keep `MAX_CONCURRENT_EXPORTS=1` on small containers so Chromium and FFmpeg do not run multiple exports at once.
- If Render returns `502` during export, verify the frontend is polling `/api/export/jobs/{jobId}` and check `/health/export` for active/queued exports.
