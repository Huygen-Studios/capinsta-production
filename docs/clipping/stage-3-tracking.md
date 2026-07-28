# Stage 3 tracking

## Task 3.2 — secure media attachment and editable project handoff

Status: complete.

Added migration 0023, the handoff manifest contract, authenticated
prepare/status/claim/complete/cancel and media-access endpoints, durable
revision/conversion-bound repository logic, restricted RLS, frontend import
journaling, server-backed descriptors, in-memory access/materialization, and
the protected minimal editor bootstrap route.

The collision policy reuses an identical conversion identity and refuses a
different identity without overwriting edits. Server-backed source bytes are
not persisted to OPFS by default. Existing local media, caption, spacing,
preview, and export implementations are unchanged.

Known limitations: durable remote export still needs a trusted media resolver;
the current preview path materializes a browser `File` in memory. There is no
cleanup scheduler or clone-on-conflict operation. Full Clipper UI remains
outside this task.

Follow-up: Stage 3 Task 3.3 should implement revision-bound clipping preview
and export orchestration using attached server media and the authoritative
EDL/remapped transcript.

Verification on 2026-07-26:

- PostgreSQL 17 migration, integration, RLS, two-user isolation, anonymous
  denial, authenticated-write denial, concurrency, expiry, stale-conversion,
  trusted lifecycle, atomic rollback, and idempotent-completion gate: 6 passed.
- The gate found and fixed one claim-boundary defect: claim now rejects a
  handoff when the clipping project's current revision no longer matches the
  revision captured by the handoff.
- Handoff/API/portable-contract and focused signed-URL tests: 13 passed.
- Frontend handoff, real Chromium import/edit/save/reload, access resolver, and
  feature flags: 15 passed. Storage safeguards: 4 passed. Focused word-spacing:
  2 passed.
- TypeScript, Python compileall, Compose config, and `git diff --check`: passed.
- The clean backend image build completed all build and smoke-test stages, then
  Docker failed while exporting layers with a host filesystem I/O error under
  `/var/lib/desktop-containerd`; final-image export remains infrastructure
  blocked and is not recorded as success.
- Supabase signing was verified with mocks only; no real Supabase network call
  was made.

## Task 3.1 — Rust clipping engines in the backend worker

Status: implementation complete; final repository-wide verification recorded
in the Task 3.1 completion report.

Added:

- Thin `clipping-runtime` Rust crate and
  `capinsta-clipping-runtime` protocol-V1 executable.
- Real Rust `derive_project`, `convert_project`, `health`, and `version`
  operations with bounded input/output and safe errors.
- Python subprocess client, configuration, Pydantic response models, stable
  result identities, revision-bound repositories, handlers, and registration.
- Migration 0022 for cache result identities and transcript provenance.
- Multi-stage backend image build and disabled-by-default worker configuration.
- Cross-language runtime fixtures plus real-binary and PostgreSQL tests.
- Runtime architecture, protocol, adapter, handler, deployment, and local
  development documentation.

Compatibility and risk:

- Existing frontend behavior and Stage 2 APIs are unchanged.
- Runtime and handlers default off.
- Stage 2 derivation inputs now include the previously missing exact media
  revision. Already queued legacy derivation jobs without it are rejected and
  should be requeued.
- Legacy derived caches without identities are treated as stale.
- The Windows adapter isolates Proactor subprocess handling from psycopg's
  Selector loop.

Follow-up:

- Task 3.2 attaches the original Supabase-backed media and hands a completed
  conversion result to an editable Capinsta project.
- A warm runtime pool may be considered only if production measurements show
  one-process-per-operation startup is material.

Verification on 2026-07-26:

- `cargo fmt --all -- --check`: passed.
- `cargo test -p clipping-runtime`: 6 passed, including real process protocol,
  invalid JSON, and 64 MiB input-bound tests.
- `cargo test -p clip-domain`: 5 passed, 1 performance smoke ignored.
- `cargo test -p project-bridge`: 13 passed.
- `cargo test --workspace --no-fail-fast`: passed (1 performance smoke ignored).
- Release build and host CLI derivation/conversion smokes passed; derivation
  produced one 2,000 ms entry and conversion produced project version 35 with
  `requiresMediaAttachment=true`.
- Real Python-to-Rust adapter tests: 13 passed, including timeout,
  cancellation, shutdown, lease loss, malformed/bounded output, structured
  Rust failure, and transport cleanup.
- Real PostgreSQL 17 runtime/orchestration tests: 10 passed, including
  derivation, conversion, stale revision rejection, and atomic rollback.
  Existing lease/persistence PostgreSQL regressions: 7 passed.
- Broad backend tests: 680 passed, 47 skipped, 1 unrelated failure because
  local Python lacks `torch` for the legacy VAD performance test.
- Web TypeScript project check, Compose config, Python compileall, and
  `git diff --check`: passed.
- Focused Capinsta tests: word-spacing passed; 188 passed and 5 existing
  unrelated assertions failed (caption/export sample-text drift and expired
  project reconciliation). A run with the wrong preload path also reproduced
  the known Bun/WASM bootstrap failure and Bun crash; the correct repository
  preload was used for the reported 193-test run.
- The Docker Rust builder stage built and its in-container health invocation
  passed. The complete shared backend image exceeded a ten-minute local build
  window while installing its pre-existing Python/browser stack, so final-image
  assembly was not verified locally.
# Task 3.3 — revision-bound preview and export orchestration

Status: implementation complete; PostgreSQL and real Linux render gates pass.
Final completion remains blocked by a host Docker filesystem I/O failure during
the complete backend image build.

Added migration 0024, `ClippingPreviewManifestV1`,
`ClippingExportRequestV1`, durable export APIs, the `clip_export` handler,
trusted EDL media preparation, independent output verification, private
`media-exports` upload, signed-download preparation, cancellation and
revision-safe atomic finalization. The implementation reuses the existing
Capinsta renderer and media-variant workspace.

Known risk: a host crash after workspace creation may leave a confined
temporary attempt directory until operational cleanup; authoritative output
replay remains deterministic. A real Supabase network export is not required,
and signed-download behavior was verified through the focused provider mock.

Verification on 2026-07-26:

- PostgreSQL 17 migration, live constraints/indexes/trigger, concurrent export
  identity, idempotency replay/conflict, stale revision/dependency protection,
  two-user RLS, anonymous denial, authoritative-write denial, hidden columns,
  trusted completion, forced atomic rollback, cancellation, and crash replay:
  7 passed.
- The gate found and fixed one deterministic retry defect: a cancelled export
  no longer blocks a new export attempt on the durable job idempotency key.
- A real Linux render used the Rust runtime to derive two EDL sections, FFmpeg
  to apply trims and a 2x playback rate, and Playwright Chromium against the
  production `/render` page. FFprobe verified a 2.002-second H.264/AAC,
  360x640 MP4; captions and `wordSpacing: 8` reached the renderer, and the
  controlled workspace was empty afterward.
- Real Chromium timeout, durable-cancellation equivalent, and lease-loss
  termination probes closed Chromium, produced no output upload, and cleaned
  their workspaces. PostgreSQL crash replay reused an identical local object,
  rejected a conflicting checksum, fenced the stale worker, and finalized one
  export and one job through the replacement worker.
- Focused Stage 3.1/3.2/3.3 backend regression set: 106 passed. Additional
  crash/storage/download set: 35 passed. TypeScript, Python compileall,
  Compose config, and `git diff --check` passed.
- Focused caption/timing/word-spacing/storage tests: 50 passed with one
  pre-existing unrelated sample-text assertion failure in
  `styleFoundation.test.ts`; the isolated assertion fails identically and was
  not changed.
- The production web image built and exported successfully after its Dockerfile
  was corrected to include the existing shared transcript-contract and Rust
  WASM packages before `bun install`.
- The complete backend image passed its Rust release build and FFmpeg system
  package stage, then Docker failed during Python package installation with
  `OSError: [Errno 5] Input/output error` and daemon EOF. BuildKit cache was
  pruned without deleting volumes, but the host Docker VHD consumed the
  remaining system-drive space. Because the failure occurred before all image
  stages completed, Task 3.3 is not marked complete.
