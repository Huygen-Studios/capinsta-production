# Rust clipping runtime architecture

Stage 3.1 exposes the authoritative Rust domain engines through the
`capinsta-clipping-runtime` executable. The durable Python worker sends one
versioned JSON request on stdin and receives one JSON response on stdout.
Diagnostics are restricted to stderr.

```text
processing job -> Python handler -> JSON CLI -> clip-domain/project-bridge
                                      |
                                      +-> validated result -> atomic PostgreSQL finalization
```

The CLI was selected because it keeps EDL generation and transcript remapping
in `clip-domain` and conversion in `project-bridge` without adding PyO3, Node,
or another runtime toolchain. Browser WASM is not used: its bootstrap is
frontend-oriented and is not a reliable server execution boundary.

`rust/crates/clipping-runtime` owns only protocol parsing, bounds, dispatch,
safe error mapping, and serialization. It does not own clipping algorithms.
The Python package `backend/server/clipping_runtime` owns trusted subprocess
execution, result validation, job dependency loading, identities, and atomic
persistence. Both handlers are disabled by default and register independently.

Known limitations:

- The protocol is one request per process; there is no warm process pool.
- Metadata is bounded at the top-level contract metadata fields, not every
  nested provider-defined object independently.
- The conversion result intentionally leaves media unattached for Task 3.2.
- Legacy Stage 2 caches without result identities are readable but considered
  stale and must be regenerated before conversion.

