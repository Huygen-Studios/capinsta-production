# Deployment

## Frontend

```powershell
cd F:\CapInsta\capinsta-production-editor
C:\Users\shrav\.bun\bin\bun.exe install
C:\Users\shrav\.bun\bin\bun.exe run build:web
```

Use `.env.example` or `apps/web/.env.example` as the frontend environment template. Use `NEXT_PUBLIC_CAPINSTA_DEBUG=false` for production.

## Backend

```powershell
cd F:\CapInsta\capinsta-production-editor\backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000
```

For local backend tests, install `requirements-dev.txt`.

Set one real transcription provider key before using Generate AI Captions:

- `GROQ_API_KEY`
- `OPENAI_API_KEY`
- `SARVAM_API_KEY`

Do not deploy `.env`, `.env.local`, `venv`, `node_modules`, `.next`, generated exports, uploads, or local MP4s.
