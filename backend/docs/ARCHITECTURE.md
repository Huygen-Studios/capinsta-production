# Huygen Caps Architecture

Huygen Caps is a monorepo.

- `frontend/`: Next.js 14 editor UI, timeline, caption styling, caption preview, export modal, and static `/render` page for frame capture.
- `server/`: FastAPI API, SQLite job store, upload handling, health checks, WebSocket progress, and MP4 export routes.
- `ai_pipeline/`: audio extraction, STT provider selection, transcript normalization, alignment repair, and SRT/VTT generation.
- `storage/`: local development runtime data only. It is ignored by Git.

## Frontend

The frontend is a Next.js app. The central API client is `frontend/src/lib/api.ts`.

Local development defaults to `http://127.0.0.1:8000` when `NEXT_PUBLIC_API_URL` is not set. Production single-service Docker builds leave `NEXT_PUBLIC_API_URL` blank so browser requests use same-origin `/api/*`.

Key frontend areas:

- `frontend/src/app/page.tsx`: editor shell.
- `frontend/src/components/editor/CaptionFirstLeftPanel.tsx`: caption-first left sidebar and active tool panel.
- `frontend/src/components/editor/CaptionEditorPanel.tsx`: Auto Subtitle setup, subtitle row editor, and chars-per-subtitle rebuild flow.
- `frontend/src/components/editor/CaptionStylePanel.tsx`: simplified live caption styling panel.
- `frontend/src/app/render/page.tsx`: headless export render frame.
- `frontend/src/components/editor/ExportModal.tsx`: export action and download UI.
- `frontend/src/components/captions/`: caption renderers shared by preview and export.
- `frontend/src/lib/editorModel.ts`: sequence, export settings, duration, and timeline helpers.

The default product shell is caption-first. The app still keeps the timeline, caption renderers, media import, export modal, and advanced editor modules, but the beginner view hides the old multi-tab Premiere-style panels.

## Backend

The backend is FastAPI. The app entrypoint is `server.main:app`.

Key backend areas:

- `server/main.py`: app, CORS, static frontend serving, health routes, startup directory creation.
- `server/api/jobs.py`: upload jobs, job polling, source video serving, MP4 export endpoint.
- `server/api/health.py`: `/health`, `/api/health`, `/health/export`, and `/api/health/export`.
- `server/headless_export.py`: Playwright and FFmpeg export pipeline.
- `server/settings.py`: env-driven runtime paths and render page URL.

## Caption Generation

Uploads are saved under `UPLOAD_DIR`, then processed in a background thread through `ai_pipeline/main.py`. STT provider selection lives in `ai_pipeline/transcriber.py`.

Supported language modes are:

- `auto_mixed_indian`
- `english`
- `hinglish`
- `telgish`

Transcripts are normalized into shared segment and word timing shapes before the frontend chunks them into editable captions.

Generated captions are stored in `useCaptionStore`. Original aligned transcript segments are stored in `useEditorStore.transcriptSegments`; Rebuild Subtitles uses those segments so changing Chars per subtitle does not re-run STT.

## Export Pipeline

The editor sends captions, style config, resolution, FPS, duration, and export mode to `POST /api/jobs/{job_id}/export`.

The backend:

1. validates the request and job,
2. resolves source media or captions-only mode,
3. determines duration from the frontend override or FFprobe,
4. loads the `/render` page in Chromium,
5. captures transparent PNG frames,
6. pipes frames to FFmpeg,
7. writes the MP4 to `EXPORT_DIR`,
8. returns a JSON download contract with `/exports/<filename>`.

FastAPI serves `EXPORT_DIR` at `/exports`.

## Deployment Architecture

Production uses one Docker web service:

- build Next.js as static files with `NEXT_OUTPUT=export`,
- install Python backend dependencies,
- install FFmpeg/FFprobe,
- install Playwright Chromium,
- serve frontend static files and API from FastAPI on the same origin.

The production command binds to `0.0.0.0:$PORT`, which is required by Render.

## Storage

Runtime storage defaults to `/tmp/huygen-caps` on Linux/Render and the system temp directory on Windows:

- `TEMP_DIR=/tmp/huygen-caps`
- `UPLOAD_DIR=/tmp/huygen-caps/uploads`
- `EXPORT_DIR=/tmp/huygen-caps/exports`
- `DB_PATH=/tmp/huygen-caps/database.sqlite`

Render web service disk is ephemeral. Use S3, Cloudflare R2, or another object store before relying on persistent uploaded media or long-lived exports.
