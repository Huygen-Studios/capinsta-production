# Runtime local development

Build and test from the repository root:

```sh
cargo test -p clipping-runtime
cargo build -p clipping-runtime
cargo run -p clipping-runtime --bin generate-runtime-fixtures
```

The generated executable is
`target/debug/capinsta-clipping-runtime` (`.exe` on Windows). Point
`CLIPPING_RUNTIME_BINARY` at that trusted path and enable only the desired
worker handlers. The executable is not needed when all runtime flags are off.

Shared requests/responses live in
`contracts/fixtures/clipping-runtime-v1`. Regeneration is explicit and derives
the domain/conversion cases from the existing Stage 1 fixtures. Review fixture
diffs after regeneration; output contains no current time or environment data.

For PostgreSQL integration tests, provide
`CLIPPING_PERSISTENCE_TEST_DATABASE_URL` for a disposable PostgreSQL 17
database and set `PYTHONPATH=backend;backend/tests` on Windows. Tests execute
the real debug binary; they skip rather than substituting a mock if either
dependency is unavailable.

