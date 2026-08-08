# Runtime bridge decision

Runtime bindings are deferred. The repository has a WASM package, but its current surface is oriented around existing editor/caption APIs and exposing `clip-domain` would require unrelated bridge and package changes. Rust remains the sole timing authority. TypeScript and Python currently validate and deserialize Rust-produced EDL JSON only; a focused WASM bridge is follow-up work after the domain fixture suite is stabilized.

This integration deferral is non-blocking for Task 1.3 because committed Rust-generated fixtures verify both consumer models.

Task 1.4 follows the same decision. `project-bridge` owns conversion; the
TypeScript package validates transport input, committed Rust-generated results,
and Capinsta project invariants without recreating conversion logic. Python
models were not added because this task adds no backend conversion API and an
unused model would create another manual representation. A focused bridge or
server-side Rust execution boundary is required before the future "Open in
Capinsta" workflow can invoke conversion.

Task 2.8 keeps this decision. FastAPI persists strict revision-bound
`project_derivation` and `project_conversion` jobs, but no Python or TypeScript
algorithm computes EDLs, remaps timestamps, or converts projects. Stage 3 must
expose the Rust engines to the durable worker and atomically persist validated
matching-revision outputs.

Stage 3.1 resolves the backend deferral with the dedicated
`capinsta-clipping-runtime` JSON CLI. It directly calls `clip-domain` for EDL
generation/remapping and `project-bridge` for conversion. Python owns only
bounded process supervision, contract validation, revision checks, and atomic
persistence. Browser WASM remains outside this backend path.
## Handoff boundary

The Rust conversion output remains authoritative. Stage 3.2 does not duplicate
conversion logic: it validates the persisted conversion identity and wraps the
exact v35 project in a portable handoff manifest. Stable Rust-generated media
IDs are resolved to owned durable assets outside the project JSON.
