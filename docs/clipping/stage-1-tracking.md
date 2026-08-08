# Stage 1 tracking

## Task 1.1 — Canonical transcript contract: complete

Added the V2 JSON Schema, language representations, compatibility adapters,
synthetic fixtures, validation tests, and contract documentation. Follow-up:
introduce schema-driven code generation before broad contract expansion, then
consume V2 at the clipping-service boundary. Risk: the existing normalized
response is seconds-based and fallback IDs are order-derived when providers
omit IDs.

## Task 1.2 — Clip project and range contracts: complete

Added non-destructive V1 clip schemas and cross-document validation. Task 1.3
subsequently supplied deterministic output-time mapping.

## Task 1.3 — Deterministic EDL engine: complete

Implemented Rust fixed-point EDL generation, point/interval mapping, transcript
remapping, representative generated fixtures, cross-language validation,
drift/determinism coverage, and a 10,000-range smoke test. Runtime bindings
remain non-blocking future integration work.

Final Rust verification: `cargo test --workspace --no-run -vv` completed in
36.29 seconds. `cargo test --workspace --no-fail-fast` completed successfully
with 49 passed, 1 ignored, 0 failed; all applicable doctests passed. Earlier
120-second attempts were cold-build/orchestration timeouts, not Rust failures.

## Task 1.4 — Non-destructive Capinsta conversion: complete

Added versioned conversion input/result schemas, the Rust `project-bridge`
engine, current project-v35 mapping, deterministic IDs, source-media attachment
mapping, editable caption conversion, structured issues, generated fixtures,
TypeScript runtime validation, optional persisted clipping provenance, and
conversion documentation.

Known non-blocking limitations: direct Rust-to-TypeScript invocation remains
deferred; future integration must attach the already-existing media asset to
Capinsta's project-scoped media store. Safe-area and filler flags are not
representable by the current project/caption shape and produce structured
warnings or policy errors.

Verification:

- `cargo fmt --check`: passed.
- `cargo test -p project-bridge`: 13 passed.
- `cargo test -p clip-domain`: 5 passed, 1 ignored.
- `cargo test --workspace --no-fail-fast`: 62 passed, 1 ignored, 0 failed.
- shared TypeScript conversion fixtures: 23 passed.
- focused Capinsta project/caption/timeline/retime tests: 35 passed.
- project migrations: 106 passed.
- web TypeScript compilation: passed.
- both conversion JSON Schemas accepted all 14 valid fixture inputs/results.
- `git diff --check`: passed.

An unrelated pre-existing storage-lifecycle test remains red:
`shouldPersistMediaFileInBrowser` returns `true` for a server-backed asset while
the test expects `false`. Conversion code does not call or change that behavior.

Task 1.4 and Stage 1 are complete. Stage 3 runtime integration still needs a
focused Rust invocation boundary plus media attachment orchestration; those are
not part of this contract/conversion task.
