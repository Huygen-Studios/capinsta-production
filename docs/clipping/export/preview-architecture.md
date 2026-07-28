# Revision-bound preview

`ClippingPreviewManifestV1` is prepared by
`POST /api/v1/clipping/projects/{projectId}/preview`. The API requires an
authenticated owner, `expectedRevision`, and `Idempotency-Key`.

Preparation locks and checks the current `ClipProjectV1`, Rust-derived EDL,
remapped transcript, conversion result, and attached ready media. The response
contains the exact converted Capinsta v35 project, stable server-backed media
descriptors, the derivation identity, a canonical remapped-transcript identity,
the conversion identity, the EDL output duration, deterministic warnings, and
a bounded expiry. It contains no signed URL, Storage path, local path, or
credentials. Preview preparation neither changes the project revision nor
renders a video.

The existing editor preview and authenticated server-backed media resolver
remain the rendering path. No player or timeline renderer was added.

