# Project conversion handler

`ProjectConversionJobHandler` executes `project_conversion` jobs. It loads the
exact project and current identity-bearing EDL cache. A current remapped
transcript is mandatory only when captions are requested. Python assembles the
existing `ClipProjectConversionInputV1`; all conversion behavior remains in
`project-bridge`.

The returned `CapinstaProjectConversionResultV1` must match the source project,
revision, target project ID, and project version contract. Validation preserves
source trims, playback rates, mapping provenance, caption mapping, and
`requiresMediaAttachment`; no signed URL is attached.

Finalization re-locks job/project dependencies, rejects stale derivation data,
and atomically writes the full conversion-result cache, revision and SHA-256
identity while completing the job/attempt and clearing the lease. The durable
job output contains only target/version/count/status summary fields. Identical
replay is safe and conflicting current results fail.

