# CapinstaProjectHandoffManifestV1

The source of truth is
`contracts/capinsta-project-handoff-manifest-v1.schema.json`. Python Pydantic
models and shared TypeScript types/validation derive from that boundary.

The manifest carries schema version 1, handoff/project/revision/conversion
identities, explicit Capinsta project schema version 35, the authoritative
converted project, attachment descriptors, non-secret provenance, UTC expiry,
sorted unique warnings, and portable metadata. Every video, audio, or image
`mediaId` referenced by the project must have exactly one attachment.

`mediaId` is the attachment key used by timeline elements.
`mediaAssetId` is the owned durable `media_assets.id`; they currently match and
are validated as equal by preparation. The list supports future multi-asset
projects even though the current conversion has one source asset.

Validation rejects missing/duplicate coverage, stale provenance, an unexpected
project schema, malformed IDs or dimensions, non-deterministic warnings,
oversized manifests, unknown descriptor fields, signed/blob/file URLs,
credentials, and absolute local paths.

