# Local Setup

## Prerequisites

- Python 3.10 or newer. Python 3.11 is recommended for Docker parity.
- Node.js 20 is recommended. Node 18+ should work locally.
- FFmpeg and FFprobe on PATH.
- One STT provider key for caption generation: `SARVAM_API_KEY`, `OPENAI_API_KEY`, or `GROQ_API_KEY`.

Check tools:

```powershell
python --version
node --version
ffmpeg -version
ffprobe -version
```

## Environment

Copy the example env file:

```powershell
Copy-Item .env.example .env
```

For local development, this is enough:

```env
NODE_ENV=development
HOST=127.0.0.1
PORT=8000
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
NEXT_PUBLIC_API_URL=
RENDER_PAGE_URL=http://localhost:3000/render
STT_PROVIDER=auto
SARVAM_API_KEY=
OPENAI_API_KEY=
GROQ_API_KEY=
```

Do not commit `.env`.

## Backend Install

```powershell
python -m venv venv
.\venv\Scripts\python.exe -m pip install --upgrade pip
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m playwright install chromium
```

Run backend:

```powershell
.\venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000 --reload --reload-exclude storage --reload-exclude frontend/.next --reload-exclude frontend/out --reload-exclude *.log
```

## Frontend Install

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## Health Checks

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/health/export
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/health/export
```

`/health` is app liveness. `/health/export` verifies FFmpeg, FFprobe, writable runtime dirs, Playwright, and Chromium launch.

## Generate Captions

1. Import an MP4 or MOV in the editor.
2. Select a language mode.
3. Click `Generate Captions`.
4. Confirm captions appear in the timeline and program monitor.
5. Use Caption Editor to adjust text or timing.

## Export

1. Open Export.
2. Choose MP4.
3. Confirm dimensions, FPS, duration source, audio, and captions count.
4. Click MP4.
5. Download from the generated MP4 button.

## Docker Local Run

```powershell
docker build -f backend/Dockerfile -t capinsta-backend .
docker run --rm --env-file backend/.env -e NODE_ENV=production -e PORT=10000 -p 10000:10000 capinsta-backend
```

Then open:

- `http://localhost:10000`
- `http://localhost:10000/health`
- `http://localhost:10000/health/export`

With Compose:

```powershell
docker compose -f backend/docker-compose.yml up --build
```
