# Capinsta

Capinsta combines the browser video editor with an Automatic Clipper for
turning long private videos into editable short-form projects and MP4 exports.

## Architecture

- `apps/web` — Next.js UI for `/clipper`, `/editor`, and `/render`.
- `backend` — FastAPI control plane and durable worker entry points.
- `rust` — clipping, transcript, EDL, conversion, and rendering domain logic.
- `contracts` and `packages/transcript-contract` — shared JSON contracts.
- Supabase — Auth, PostgreSQL, and private source/variant/export buckets.

Large source files upload directly from the authenticated browser to Supabase
Storage with resumable TUS. FastAPI authorizes and verifies uploads but never
proxies media bytes. Durable PostgreSQL jobs are processed by bounded media,
AI, Rust-runtime, export, and maintenance workers.

## Local development

Copy the example environment files, install the existing dependencies, then:

```powershell
.\RUN_CLIPPER_LOCAL.ps1
```

Stop the local services with:

```powershell
.\STOP_CLIPPER_LOCAL.ps1
```

Local authentication and filesystem media are development-only flags. Both are
rejected when `NODE_ENV=production`.

## Verification

```text
python -m compileall -q backend
bun x tsc --noEmit
cargo fmt --all -- --check
cargo test --workspace --no-fail-fast
docker compose -f docker-compose.production.yml config --quiet
git diff --check
```

## Production

Production images are built on Linux by
`.github/workflows/production.yml` and published to GHCR. The workflow applies
additive migrations before triggering the existing Coolify deployment.
`docker-compose.production.yml` uses Supabase externally and stores only
bounded temporary worker files on the VPS.

Start with admissions disabled, verify one internal workflow, then enable a
small `PRIVATE_BETA_ALLOWLIST`. See `docs/production/coolify-deployment.md` for
required GitHub/Coolify values and rollback.
