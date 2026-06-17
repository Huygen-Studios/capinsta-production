# How To Run Capinsta Editor

Use the final production folder:

```powershell
cd F:\CapInsta\capinsta-production-editor
```

## Backend

```powershell
cd F:\CapInsta\capinsta-production-editor\backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000
```

## Frontend

```powershell
cd F:\CapInsta\capinsta-production-editor
C:\Users\shrav\.bun\bin\bun.exe install
$env:NEXT_PUBLIC_ENABLE_AI_CAPTIONS="true"
$env:NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT="false"
$env:NEXT_PUBLIC_CAPINSTA_API_BASE_URL="http://127.0.0.1:8000"
$env:NEXT_PUBLIC_CAPINSTA_DEBUG="false"
C:\Users\shrav\.bun\bin\bun.exe run dev:web
```

Open `http://localhost:3000`.

Use `.env.example`, `apps/web/.env.example`, and `backend/.env.example` for the full placeholder environment list. Do not put real secrets in docs.
