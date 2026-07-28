# Render media resolution

The worker resolves the conversion's stable media ID against the locked,
owner-matched `media_assets` row. Source size and duration must be known and
within configured bounds.

Local development yields a trusted local source. Supabase yields a short-lived
private HTTPS source directly to the safe FFmpeg subprocess; Python never loads
the complete source into memory and the URL is never persisted. FFmpeg writes
the Rust EDL result into the controlled existing media-variant workspace:

`{CLIPPING_EXPORT_TEMP_ROOT}/{jobId}/{attemptNumber}/`

The EDL adapter applies only the already-derived ordered source trims and
playback rates, including bounded `atempo` chains for audio. The prepared file
is then passed to the existing Capinsta renderer together with the converted
caption document. Normal workspace cleanup runs after success, failure,
timeout, cancellation, shutdown, and lease loss and is confined beneath the
configured root.

The output object path is deterministic:

`{ownerId}/{safeProjectId}/exports/r{revision}/{specHashPrefix}/{exportId}.mp4`

Unsafe project identifiers are represented by a deterministic hash segment.
Retries render to the same object identity. A matching existing object is
reused by the Storage adapter; conflicting content fails. Cleanup of historical
orphan objects and abandoned workspaces after a host crash is deferred.

