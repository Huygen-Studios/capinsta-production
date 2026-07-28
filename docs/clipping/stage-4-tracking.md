# Stage 4 Tracking — Unified Automatic Clipper MVP

Status: complete, with Docker image construction deferred because the local
Docker Desktop Linux engine is unavailable.

## Added

- `apps/web/migrations/0025_automatic_clipper.sql`
- `backend/server/automatic_clipper/` and authenticated API registration
- `rust/crates/shorts-domain/` plus clipping-runtime and project-bridge
  automatic composition operations
- `/clipper` and its runtime-validated API client
- Bundled MediaPipe BlazeFace model/license/notice
- Bundled Noto Color Emoji font/license
- Backend, live PostgreSQL, Rust, TypeScript, conversion, and workload tests
- `docs/clipping/automatic-clipper-mvp.md`

## Verification

- Full Rust workspace: passed
- Backend Stage 1–4 regression selection: 203 passed
- Focused clipper/export/runtime selection: 31 passed
- PostgreSQL 17 candidate/RLS/concurrency tests: 3 passed
- Focused TypeScript/frontend tests: passed
- Real Chromium caption font and editable handoff reload: passed
- Real Chromium Stage 4 hook + captions to 1080x1920 H.264/AAC MP4: passed
- Thirty-minute bounded planning smoke test: passed
- TypeScript, Python compileall, Compose config, Rust formatting, and diff
  whitespace checks: passed
- Docker images: not run; Docker Desktop Linux engine pipe was absent
- Ponytail review: lean already; no unused abstraction to remove

## Known risks

- MediaPipe Tasks and bundled model inclusion still need proof in the backend
  image when Docker is available.
- Platform safe zones are conservative versioned profiles and need periodic
  real-platform verification.
- Short-range face detection intentionally falls back on wide or uncertain
  content instead of guessing.
- The working tree contains the cumulative uncommitted Stage 1–4 expansion;
  release review must preserve that dependency order.

## Follow-up

Only after the verification gate passes:

Stage 5 — Production Launch: real Supabase/Coolify deployment, final Docker
verification, cleanup schedulers, monitoring, quotas, Whop access and billing,
privacy controls, rate limiting, and private beta launch.
