# Release Readiness Verification

Date: 2026-07-05

Current worktree: `F:\CapInsta\capinsta-production-editor`

Reference backup: `G:\Huygen Studios\side projects\stable versions\Huygen-Caps-main-v4\capinsta-production-main`

This was a verification and targeted-fix pass. I did not make broad new architecture changes. I made two targeted fixes after verification exposed release blockers:

- Removed remaining legacy caption-tuning env drift for `STABLE_TS_MAX_AUDIO_SECONDS` and `MAXIMUM_ESTIMATED_WORD_RATIO` from resolver/env mapping and `.env.example`.
- Fixed `backend/server/api/jobs.py` route compatibility after the `Cache-Control: no-store` change so FastAPI can import the route and old direct test calls still work.

## Passed Checks

### Preset Parity

Command:

```powershell
$env:PYTHONPATH='backend'; python -m pytest backend\tests\test_reference_preset_parity.py backend\tests\test_pipeline_config_and_timing_policy.py backend\tests\test_timing_presets.py backend\tests\test_final_timing_quality_gate.py backend\tests\test_export_renderer_readiness_contract.py -q
```

Result:

```text
60 passed, 89 warnings in 21.12s
```

Coverage:

- All 10 current resolved presets deep-compare equal to the reference backup.
- No-env case passes.
- Runtime-only env case passes.
- Legacy caption-tuning env case passes: `STABLE_TS_MAX_AUDIO_SECONDS`, `MAXIMUM_ESTIMATED_WORD_RATIO`, `MAXIMUM_DETERMINISTIC_FALLBACK_RATIO`, and `MINIMUM_REAL_TIMED_WORD_COVERAGE` do not alter resolved caption behavior.
- `docs/preset-parity-report.json` reports `allResolvedPresetsMatch: true`.

### Backend Suite

Command:

```powershell
$env:PYTHONPATH='backend'; python -m pytest backend\tests -q
```

Initial result:

```text
14 collection errors
FastAPIError: Response | None is not a valid route parameter field
```

Targeted fix:

- Changed `get_job(job_id, response: Response | None = None, ...)` back to a normal injected `Response`.
- Kept direct-call compatibility by detecting when old tests pass the DB connection as the second positional argument.

Final result:

```text
422 passed, 1 skipped, 93 warnings in 80.81s
```

### Frontend CapInsta Tests

Focused lifecycle command:

```powershell
bun test apps/web/src/capinsta/jobPolling.test.ts apps/web/src/capinsta/captionJobLifecycle.test.ts
```

Result:

```text
17 pass, 0 fail
```

Media upload command:

```powershell
bun test apps/web/src/capinsta/mediaAssetApi.test.ts
```

Result:

```text
4 pass, 0 fail
```

File-by-file CapInsta suite command:

```powershell
$files = Get-ChildItem -Path apps\web\src\capinsta -Filter *.test.ts | Sort-Object Name
foreach ($f in $files) { bun test $f.FullName }
```

Result:

```text
CAPINSTA_INDIVIDUAL_COUNT=24
CAPINSTA_INDIVIDUAL_FAILED=
166 pass, 0 fail across individual files
```

Covered behavior:

- Client timeout reconciliation loads completed backend result instead of showing local timeout.
- Failed backend terminal status surfaces backend error.
- Stale running status cannot overwrite terminal state.
- Caption upload creates proper multipart requests and parses structured FastAPI errors.
- Local persisted media is converted back to a named `File` before caption upload.
- Export view-model tests preserve estimated timing instead of relabeling it as aligned.

### Import and Compile Checks

Command:

```powershell
python -m py_compile backend\ai_pipeline\pipeline_config.py backend\ai_pipeline\timing_presets.py backend\ai_pipeline\sync\final_quality_gate.py backend\ai_pipeline\sync\stable_refine.py backend\ai_pipeline\main.py backend\server\headless_export.py backend\server\transcription_control.py backend\server\api\health.py backend\server\api\jobs.py
```

Result: passed with no output.

Command:

```powershell
$env:PYTHONPATH='backend'; @'
import importlib
modules = [
    'ai_pipeline.pipeline_config',
    'ai_pipeline.timing_presets',
    'ai_pipeline.main',
    'ai_pipeline.sync.final_quality_gate',
    'ai_pipeline.sync.stable_refine',
    'server.headless_export',
    'server.transcription_control',
    'server.api.health',
    'server.api.jobs',
]
for name in modules:
    importlib.import_module(name)
    print('IMPORT_OK', name)
'@ | python -
```

Result:

```text
IMPORT_OK ai_pipeline.pipeline_config
IMPORT_OK ai_pipeline.timing_presets
IMPORT_OK ai_pipeline.main
IMPORT_OK ai_pipeline.sync.final_quality_gate
IMPORT_OK ai_pipeline.sync.stable_refine
IMPORT_OK server.headless_export
IMPORT_OK server.transcription_control
IMPORT_OK server.api.health
IMPORT_OK server.api.jobs
```

### Export Health Endpoint

Command:

```powershell
$env:PYTHONPATH='backend'; @'
import json, re
from fastapi.testclient import TestClient
from server.main import app
response = TestClient(app).get('/health/export')
print('STATUS', response.status_code)
payload = response.json()
summary = {k: payload.get(k) for k in ('status','backendBuildSha','frontendBuildSha','rendererContractVersion','rendererAvailable','ffmpegAvailable','ffprobeAvailable')}
print(json.dumps(summary, indent=2, sort_keys=True))
text = json.dumps(payload)
print('SECRETISH_MATCH', bool(re.search(r'(render_token|authorization|secret|transcript|captionText|signed)', text, re.I)))
'@ | python -
```

Result:

```json
{
  "status": "degraded",
  "backendBuildSha": "unknown",
  "frontendBuildSha": "unknown",
  "rendererContractVersion": 1,
  "rendererAvailable": false,
  "ffmpegAvailable": true,
  "ffprobeAvailable": true
}
```

Secret scan result:

```text
SECRETISH_MATCH False
```

This endpoint exposes safe build/renderer metadata and did not expose tokens, transcript text, caption text, signed URLs, or authorization data in the local response.

### Whitespace Check

Command:

```powershell
git diff --check
```

Result: no whitespace errors. Git reported LF-to-CRLF warnings for touched files only.

## Failed Checks

### Full Folder Bun Test Runner

Command:

```powershell
bun test apps/web/src/capinsta
```

Result:

```text
panic(main thread): Segmentation fault
oh no: Bun has crashed. This indicates a bug in Bun, not your code.
```

Interpretation:

- The folder-level command is not green.
- All 24 files pass when run individually, so this currently looks like a Bun 1.3.14 Windows runner crash rather than a failing assertion.

### TypeScript Check

Command:

```powershell
bunx tsc --noEmit -p apps/web/tsconfig.json
```

Result:

```text
apps/web/scripts/lint-with-baseline.ts(60,15): error TS2868: Cannot find name 'Bun'.
apps/web/scripts/verify-billing-migrations.ts(12,15): error TS2868: Cannot find name 'Bun'.
apps/web/scripts/verify-billing-migrations.ts(71,9): error TS2868: Cannot find name 'Bun'.
```

Interpretation:

- No changed CapInsta/editor application file errors appeared in this run.
- The project-level TS command still fails because script files reference Bun globals without Bun types.

### True Browser Export Smoke

Attempt 1:

```powershell
bun run dev --hostname 127.0.0.1 --port 3017
```

Result:

```text
Unable to acquire lock at apps\web\.next\dev\lock
```

An existing Next dev process was already running on port 3003.

Attempt 2:

```powershell
$env:RENDER_PAGE_URL='http://127.0.0.1:3003/render'; python backend\scripts\verify_real_export.py
```

Result:

```text
[verify] render URL: http://127.0.0.1:3003/render
[verify] FAILED to load render page: status=500
```

Browser page error:

```text
SUPABASE_SERVICE_ROLE_KEY expected string, received undefined
ADMIN_SECURITY_PEPPER expected string, received undefined
INTERNAL_ADMIN_API_SECRET expected string, received undefined
INTERNAL_MAINTENANCE_SECRET expected string, received undefined
```

Interpretation:

- A true browser export smoke was attempted and failed before renderer readiness because the local web server is missing required env.
- This cannot be counted as a passing export verification.

### Static Renderer Readiness Search

Command:

```powershell
rg -n "__CAPINSTA_RENDER_READY__|__RENDER_PAGE_LOADED__|Page\.wait_for_function|wait_for_function|loaded flag|ready flag" backend/server/headless_export.py backend/scripts apps/web/src/app/render -g "*.py" -g "*.ts" -g "*.tsx"
```

Remaining backend waits:

- `backend/server/headless_export.py:623` waits for `window.__CAPINSTA_RENDER_STATE__.status` to become `ready` or `error`.
- `backend/server/headless_export.py:1317` waits for `window.__CAPINSTA_RENDER_STATE__.version === 1`.
- `backend/server/headless_export.py:1634` waits for `window.__CAPINSTA_RENDER_STATE__.version === 1` during recovery.
- `backend/scripts/verify_real_export.py` waits for the same structured state.

Remaining legacy flag references:

- `backend/server/headless_export.py:1278-1279` reads legacy flags only in a readiness diagnostic probe.
- `backend/server/headless_export.py:1429` includes a legacy loaded flag in diagnostics.
- `apps/web/src/app/render/render-client.tsx` still sets `__RENDER_PAGE_LOADED__`, `__CAPINSTA_RENDER_READY__`, and `window.isReady()` as compatibility flags.

Interpretation:

- I did not find a backend execution path still waiting on the old readiness flags.
- Legacy flags remain as compatibility/diagnostic surface and should be removed only after confirming no external consumers depend on them.

### Direct Environment Reads

Command:

```powershell
rg -n "os\.getenv\(|os\.environ\[|os\.environ\.get" backend\ai_pipeline backend\server -g "*.py"
```

Result:

- Legacy drift variables are no longer found in runtime code.
- Direct env reads still exist in algorithm-adjacent modules such as `backend/ai_pipeline/aligner.py`, `backend/ai_pipeline/audio.py`, `backend/ai_pipeline/timing.py`, `backend/ai_pipeline/sync/stable_refine.py`, and `backend/ai_pipeline/transcriber.py`.

Interpretation:

- Preset parity proves the known drift variables no longer alter resolved presets.
- The repository still has direct env reads in legacy/fallback paths. A line-by-line migration/classification remains required before claiming the canonical-config rule is fully satisfied.

## Skipped Checks

### True End-to-End Caption Job

Reason:

- No local backend is listening on `127.0.0.1:8000` or `127.0.0.1:10000`.
- No STT provider secrets are present in this shell: `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, and `SARVAM_API_KEY` were all absent.

Commands:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health/ready
Invoke-WebRequest http://127.0.0.1:10000/health/ready
```

Result:

```text
Unable to connect to the remote server
```

This means the browser/API E2E caption path was not proven in this pass.

### True API Export Job

Reason:

- Local `/render` route returns HTTP 500 due missing web env.
- `/health/export` reports `rendererAvailable: false` because the local bundled frontend distribution is not present.

This means the production export API path was not proven in this pass.

### Full Production-Like Snapshot Replay

Reason:

- Snapshot immutability is covered by resolver/repository-level tests, including historical snapshot behavior after environment changes.
- A full queued worker replay against real persisted production records was not run.

### Completed Project Reopen After `capinstaServerJobId` Clear

Reason:

- Lifecycle and heartbeat terminal behavior tests pass.
- A full browser project reopen test proving completed output lookup after `capinstaServerJobId` is cleared or terminal-marked was not run.

## Remaining Risk

### Blocker

- True browser export smoke failed locally with `/render` HTTP 500.
- True end-to-end caption job was not run.
- Therefore this is not production-ready.

### High

- Direct algorithm-adjacent env reads still exist outside the canonical resolver in legacy/fallback modules. Known drift envs are fixed, but the broader canonical-config acceptance criterion is not fully proven.
- Project-level TypeScript still fails on Bun script globals.
- Folder-level `bun test apps/web/src/capinsta` crashes Bun 1.3.14 on Windows, even though individual files pass.

### Medium

- `/health/export` reports `rendererAvailable: false` in this checkout because bundled frontend assets are absent.
- `backendBuildSha` and `frontendBuildSha` return `unknown` locally; deployment should inject real build identifiers.
- Renderer legacy compatibility flags remain in the frontend and diagnostics.

### Low

- Test output includes deprecation warnings from third-party packages and Python event-loop policy warnings on Windows.
- `git diff --check` reports LF-to-CRLF warnings only.

## Deployment Steps

1. Remove deprecated caption-tuning env vars from Coolify/backend environments if present:
   - `STABLE_TS_MAX_AUDIO_SECONDS`
   - `MAXIMUM_ESTIMATED_WORD_RATIO`
   - `MAXIMUM_DETERMINISTIC_FALLBACK_RATIO`
   - `MINIMUM_REAL_TIMED_WORD_COVERAGE`
2. Deploy backend and frontend from the same commit.
3. Set safe build metadata:
   - `GIT_SHA` or `COMMIT_SHA`
   - `FRONTEND_BUILD_SHA` or `NEXT_PUBLIC_BUILD_SHA`
   - `BACKEND_BUILD_VERSION` or `APP_VERSION`
4. Verify backend:
   - `GET /health/ready`
   - `GET /health/export`
   - confirm `rendererContractVersion: 1`
   - confirm no secret/token/caption/transcript data is present.
5. Verify frontend:
   - open editor over the production HTTPS origin.
   - import a WebM and MP4.
   - generate captions from each file.
   - confirm no local timeout after backend completion.
6. Verify export:
   - run one minimal caption export.
   - run one caption+video export.
   - confirm failures, if any, include `renderer_ready` diagnostics rather than only `Page.wait_for_function`.
7. Watch backend logs for:
   - terminal job transitions.
   - heartbeat stop logs.
   - renderer readiness diagnostics.
   - timing provenance counts.

## Rollback Steps

1. Roll back backend and frontend together to the last known working commit/image.
2. If export is the only failing surface, temporarily disable risky export optimizations through existing operational flags:
   - `EXPORT_SPARSE_RENDER_ENABLED=false`
   - restore previous render page URL settings if the bundled renderer path is bad.
3. Do not reintroduce removed caption-tuning env overrides as a rollback path; they were the preset-drift source.
4. Clear stuck jobs through the existing admin/maintenance path rather than mutating job snapshots.
5. Re-run:
   - `GET /health/export`
   - one caption job
   - one export job

## Staging and Production Readiness

Safe for staging: yes, as a verification candidate only, provided staging has real web/backend env, STT provider secrets, frontend bundle, and the staging gate runs one real caption job plus one real export job.

Safe for production: no.

Reason: this pass did not complete a true end-to-end caption job, and the true browser export smoke failed before renderer readiness. Unit/integration tests are green for the targeted reliability logic, but the requested production-grade browser/export and caption-job proof is not complete.
