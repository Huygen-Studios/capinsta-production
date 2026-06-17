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
| `MAX_CONCURRENT_EXPORTS` | No | backend | `1` | `1` | Maximum background MP4 exports running at the same time. Keep `1` on small Render instances. |
| `MAX_EXPORT_DURATION_SECONDS` | No | backend | `300` | `300` | Rejects unexpectedly long exports before Chromium/FFmpeg work starts. |
| `TEMP_DIR` | No | backend | `/tmp/huygen-caps` on Linux, system temp on Windows | `/tmp/huygen-caps` | Runtime temp root. |
| `UPLOAD_DIR` | No | backend | `${TEMP_DIR}/uploads` | `/tmp/huygen-caps/uploads` | Uploaded media storage. |
| `EXPORT_DIR` | No | backend | `${TEMP_DIR}/exports` | `/tmp/huygen-caps/exports` | Exported MP4 storage served at `/exports`. |
| `DB_PATH` | No | backend | `${TEMP_DIR}/database.sqlite` | `/tmp/huygen-caps/database.sqlite` | SQLite job DB. |
| `RUNTIME_CLEANUP_HOURS` | No | backend | `24` | `24` | Best-effort cleanup of old uploads/exports. |
| `RENDER_PAGE_URL` | No | backend export | `http://localhost:3000/render` | omit | Headless render page override. Production uses bundled `/render.html`. |
| `FFMPEG_PATH` | No | backend | `ffmpeg` | omit | Optional explicit local FFmpeg executable. |

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
