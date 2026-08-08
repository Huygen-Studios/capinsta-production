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
$env:BACKEND_INTERNAL_URL="http://127.0.0.1:8000"
$env:NEXT_PUBLIC_CAPINSTA_DEBUG="false"
C:\Users\shrav\.bun\bin\bun.exe run dev:web
```

Open `http://localhost:3000`.

Use `.env.example`, `apps/web/.env.example`, and `backend/.env.example` for the full placeholder environment list. Do not put real secrets in docs.

## Validation Commands

Run frontend commands from the web app folder:

```powershell
cd F:\CapInsta\capinsta-production-editor\apps\web
bunx tsc --noEmit --pretty false
bun run lint
bun run test:unit
bun run build
```

`bun run lint` runs full ESLint through a baseline gate: auth, billing, payment, entitlement, account, donation, pricing, and changed source files must be clean. Existing unrelated editor/timeline/content lint debt is reported but does not hide new failures in changed/protected files. Use this command to print the raw unresolved baseline:

```powershell
bun run lint:raw
```

When this command succeeds while legacy errors still exist, report it as
`baseline lint gate passed`, not as `full lint passed`. Update the documented
baseline only after reviewing raw ESLint output:

```powershell
bun run lint:update-baseline
```

`bun run test:unit` runs Bun-compatible tests under `apps/web/src` only. It intentionally does not discover `apps/web/e2e` because those files must run through Playwright.

Run browser tests with the Playwright runner:

```powershell
cd F:\CapInsta\capinsta-production-editor\apps\web
bun run test:e2e
```

`bun run test:e2e` starts a local Next.js server automatically with the stable
webpack dev bundler, waits for `/api/health`, runs Playwright, and shuts the
server down on completion. It uses local placeholder secrets only for that
disposable server. Use
`CAPINSTA_QA_URL` or `ADMIN_E2E_BASE_URL` to target another non-production app,
and set `CAPINSTA_E2E_SKIP_WEBSERVER=true` only when that app is already running.
Authenticated admin specs require isolated staging `ADMIN_E2E_*` credentials and
will skip when those credentials are absent.
