# Clipping runtime protocol V1

Each invocation accepts exactly one UTF-8 JSON `ClippingRuntimeRequestV1`:

```json
{"protocolVersion":1,"requestId":"req_001","operation":"health","payload":{},"options":{}}
```

The response echoes `requestId` and contains `protocolVersion`, `ok`, `result`,
sorted/deduplicated `warnings`, and `error`. On failure, `result` is null and
`error` contains a machine-readable `code`, safe `message`, and optional
`fieldPath`. Protocol or execution failures return a nonzero process status.
Stdout contains only the single JSON response.

Operations are `health`, `version`, `derive_project`, and `convert_project`.
`derive_project` accepts `clipProject`, `transcript`, and
`options.includeRemappedTranscript`; it delegates EDL generation and remapping
to `clip-domain`. `convert_project` accepts the existing
`ClipProjectConversionInputV1` and delegates to `project-bridge`.

Compile-time Rust bounds:

| Input | Limit |
| --- | ---: |
| stdin | 64 MiB |
| stdout | 128 MiB |
| ranges | 5,000 |
| transcript words | 1,000,000 |
| transcript segments | 200,000 |
| serialized top-level metadata | 1 MiB per checked object |

The Python adapter independently bounds stdin, stdout, and stderr. Stable error
codes include `invalid_json`, `invalid_protocol`,
`unsupported_protocol_version`, `unknown_operation`, `input_too_large`,
`output_too_large`, `invalid_clip_project`, `invalid_transcript`,
`clip_project_transcript_mismatch`, `edl_generation_failed`,
`transcript_remapping_failed`, `invalid_conversion_input`,
`conversion_failed`, and `internal_runtime_error`. Messages never include
payloads, credentials, URLs, stack traces, or repository paths.

Serialization contains no timestamps or random IDs. Domain collections retain
their authoritative order and warnings are sorted, so repeated semantic input
produces identical semantic output.

