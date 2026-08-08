# Backend runtime adapter

`ClippingRuntimeClient` invokes the configured executable with
`asyncio.create_subprocess_exec`; no shell or temporary file is involved.
Requests use canonical compact JSON. The adapter concurrently drains bounded
stdout/stderr, enforces the smaller of runtime and job timeouts, validates the
response envelope with Pydantic, and verifies protocol and request identities.
Raw stderr and full contracts are never logged or returned through APIs.

On timeout, cancellation, shutdown, or lease loss the process group is
terminated and then killed after the configured grace period. Windows uses an
isolated Proactor event loop for subprocess pipes while psycopg remains on its
required Selector loop. Transport cleanup is completed before that loop closes.

Startup registration calls both `version` and `health`, checks protocol 1 and
the operations required by the enabled handlers, and fails only the worker
startup when incompatible. API processes and workers without these handlers do
not inspect the binary.

Adapter failures are normalized as `ClippingRuntimeError` with safe codes and
retryability. Environment/start and timeout failures are retryable; invalid
contracts, incompatible protocols, stale revisions, and domain failures are
permanent.

