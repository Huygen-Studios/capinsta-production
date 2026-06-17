# Docker

The root `Dockerfile` builds and runs the production app as a single container.

## What The Dockerfile Does

1. Uses Node 20 to install frontend dependencies.
2. Builds the Next.js frontend with `NEXT_OUTPUT=export`.
3. Uses Python 3.11 slim for the runtime image.
4. Installs FFmpeg, FFprobe, Chromium dependencies, and Python requirements.
5. Installs Playwright Chromium.
6. Copies the built frontend into `frontend/out`.
7. Starts FastAPI on `0.0.0.0:$PORT`.

No dev servers are used in production.

## Build

```powershell
docker build -t huygen-caps .
```

## Run

```powershell
docker run --rm --env-file .env -e NODE_ENV=production -e PORT=10000 -p 10000:10000 huygen-caps
```

Open:

```text
http://localhost:10000
http://localhost:10000/health
http://localhost:10000/health/export
```

## Docker Compose

```powershell
docker compose up --build
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

## Troubleshooting

If `/health` fails:

- The app did not start.
- The container is not bound to the mapped port.
- Check logs for dependency import errors.

If `/health/export` is degraded:

- Confirm FFmpeg and FFprobe are installed.
- Confirm Playwright Chromium installed and can launch.
- Confirm `/tmp/huygen-caps` is writable.

If MP4 export is slow:

- The default CPU encoder is `libx264`.
- Render free/starter instances may be slow for long videos.
- Keep test exports short while validating deployment.
- Keep `MAX_CONCURRENT_EXPORTS=1` on small containers so Chromium and FFmpeg do not run multiple exports at once.
- If Render returns `502` during export, verify the frontend is polling `/api/export/jobs/{jobId}` and check `/health/export` for active/queued exports.
