# Durable media variants

Task 2.5 adds four private, revision-bound artifacts after a successful
`media_probe`: an editing proxy, transcription WAV, poster JPEG, and waveform
JSON. Every artifact has a durable `media_variants` row before work starts and
a durable processing job. PostgreSQL stores metadata and a private bucket/path;
it never stores bytes or signed URLs.

The lifecycle is `queued -> processing -> uploading -> verifying -> ready`.
Permanent failures become `failed`; cancellation returns an in-progress row to
`queued`. Deletion states are reserved for lifecycle work. Final readiness and
job/attempt success commit in one transaction.

Variant identity is `(media asset, variant type, source media revision,
generation spec hash)`. The SHA-256 hash is computed from sorted, compact JSON.
The deterministic private path is:

```text
{ownerId}/{mediaAssetId}/variants/{variantType}/r{revision}/{hashPrefix}/{file}
```

An upload that succeeded before a crash is inspected on retry. Identical
content is reused when the provider exposes a matching checksum; conflicting
content fails safely. Orphan discovery and deletion remain a later scheduler.

Planning is enabled separately with `ENABLE_MEDIA_VARIANT_PLANNING=true`.
Handlers are disabled by default and enabled with
`ENABLE_MEDIA_VARIANT_HANDLERS=true`. `MEDIA_VARIANT_JOB_TYPES` selects a
subset, allowing probe and variant workers to be deployed as separate roles.
