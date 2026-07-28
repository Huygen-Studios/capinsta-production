# ClipProjectV1

The JSON Schema files `contracts/clip-project-v1.schema.json` and `clip-range-v1.schema.json` are the contract source of truth. A project is non-destructive: it references source media and retains effective source boundaries in integer milliseconds; it never stores replacement media or authoritative output timestamps.

`ranges.order` is explicit and enabled orders are unique (gaps are allowed). Source overlap, repeated ranges, and source-nonchronological order are valid. `sourceStartMs`/`sourceEndMs` are final effective bounds; pre/post-roll records derivation only. Rates are constrained to 0.25–4.0. Disabled ranges remain intact but will not participate in future output mapping.

Selections are optional and reference transcript IDs/entities rather than copied text. `transcriptRevision` detects stale selections. Cross-document validation returns structured issues. Project status is currently strict for V1; a new schema version is required for new lifecycle values. Future APIs use `revision` for optimistic concurrency.
