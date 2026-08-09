# Capinsta Editor

Capinsta Editor is the production packaging of the Capinsta caption engine integrated into the OpenCut Classic editor foundation.

The frontend remains the OpenCut Classic editing shell: media import, timeline, preview, project state, and export. Capinsta provides AI caption generation, word timing, active-word preview, caption style presets, edit/timing metadata, and styled subtitle export.

## Structure

- `apps/web` - integrated browser editor.
- `backend` - Capinsta FastAPI caption backend.
- `docs` - deployment, QA, rollback, and integration notes.

## Start Backend

```powershell
cd F:\CapInsta\capinsta-production-editor\backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000
```

## Start Frontend

```powershell
cd F:\CapInsta\capinsta-production-editor
C:\Users\shrav\.bun\bin\bun.exe install
$env:NEXT_PUBLIC_ENABLE_AI_CAPTIONS="true"
$env:NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT="false"
$env:NEXT_PUBLIC_CAPINSTA_API_BASE_URL="http://127.0.0.1:8000"
$env:NEXT_PUBLIC_CAPINSTA_DEBUG="false"
C:\Users\shrav\.bun\bin\bun.exe run dev:web
```

Copy `.env.example` to `.env.local` for local development and fill placeholders. Do not commit real secrets.

## Validation

```powershell
C:\Users\shrav\.bun\bin\bun.exe test apps/web/src/capinsta
C:\Users\shrav\.bun\bin\bun.exe test apps/web/src/capinsta/exportRender.test.ts
C:\Users\shrav\.bun\bin\bun.exe run build:web

cd backend
.\venv\Scripts\python.exe -m compileall ai_pipeline server
.\venv\Scripts\python.exe -m pytest -q
```

Full frontend tests currently include inherited OpenCut Classic failures unrelated to Capinsta. See `docs/known-issues.md`.

## Rollback

AI captions can be disabled with `NEXT_PUBLIC_ENABLE_AI_CAPTIONS=false`.
Sample caption import can be disabled with `NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT=false`.
Existing projects without Capinsta metadata remain backward-compatible.
