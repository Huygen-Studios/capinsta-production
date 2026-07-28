# Runtime deployment

The backend Dockerfile uses a Rust builder stage to compile only the
`clipping-runtime` package in release mode, strips it, and copies
`capinsta-clipping-runtime` into the final Python image. Cargo, rustc, build
caches, and source files are not required at runtime. The image build invokes a
real protocol health request.

For a Coolify domain-runtime worker, use the shared backend image and the
clipping-worker command, keep the API port private, and configure:

```env
ENABLE_CLIPPING_RUST_RUNTIME=true
CLIPPING_RUNTIME_BINARY=/usr/local/bin/capinsta-clipping-runtime
ENABLE_PROJECT_DERIVATION_HANDLER=true
ENABLE_PROJECT_CONVERSION_HANDLER=true
```

The handlers can be enabled independently. Keep the master flag and both
handler flags false in API-only services. Configure the existing durable
database and worker variables normally; do not expose the binary path to web
build variables. A deployment health smoke is:

```sh
printf '%s' '{"protocolVersion":1,"requestId":"health","operation":"health","payload":{},"options":{}}' |
  /usr/local/bin/capinsta-clipping-runtime
```

Startup itself performs version/health compatibility validation and refuses to
claim runtime jobs when the binary is missing or incompatible.

