# Durable media probe

`media_probe` is the first production handler in the durable processing
registry. It is registered only when both the durable worker and
`ENABLE_MEDIA_PROBE_HANDLER=true` are configured. Upload completion remains
the only normal producer of the job.

## Input

`MediaProbeJobInputV1` contains `schemaVersion: 1`,
`jobType: "media_probe"`, the stable `mediaAssetId`,
`expectedMediaRevision`, `storageObjectRevision`, `requestedFields: null`, and
optional non-sensitive `metadata`.

It cannot contain a URL, bucket, object path, local path, token, executable, or
FFprobe options. The handler resolves storage identity from the locked asset
row and verifies that the job owner, job media reference, asset owner, asset
revision, and storage-object revision agree.

## Execution and output

The coarse stages are `resolving_asset`, `authorizing_storage`, `probing`,
`normalizing`, and `persisting_metadata`. The worker owns claiming,
heartbeats, cancellation, timeouts, retries, and attempt history.

The handler inspects the durable object, opens a provider-neutral source, runs
FFprobe, normalizes allow-listed fields, and uses a narrow transactional
finalizer. The finalizer verifies the live claim token and lease, updates
`media_assets`, completes the job, writes bounded output, updates the attempt,
and clears ownership in one PostgreSQL transaction.

`MediaProbeResultV1` contains integer duration milliseconds, rational FPS,
display and encoded dimensions, normalized rotation, selected streams,
bounded container fields, deterministic warning codes, and the resulting
asset revision. It contains no source URL, local path, credential, raw FFprobe
response, raw stderr, arbitrary tag, worker identity, or claim token.

Permanent failures are finalized transactionally as `probe_failed` plus a
failed job. Retryable failures retain `probing` while the job waits for another
attempt.

