# Clipping export security

All preview and export endpoints require the existing JWT authentication and
product-access middleware. Repository queries repeat owner checks. Migration
0024 enables RLS, grants authenticated users a safe read-only column set for
their own exports, denies anonymous access, and revokes browser insert, update,
and delete. Service-role workers retain authoritative writes.

Client input cannot select executables, arguments, filters, dimensions,
Storage buckets or paths, local paths, signed URLs, or browser targets.
Subprocesses use fixed argument arrays without a shell. Export object paths are
validated independently from source and variant paths.

Ready downloads are owner-scoped and issue a bounded, ephemeral signed URL only
after Storage metadata still matches the durable size and checksum. URLs and
credentials are never written to project, preview, export, or job records.
Public status excludes worker IDs, claim tokens, raw job input/output, Storage
paths, renderer stderr, and failure internals.

Renderer output is independently probed for MP4, one H.264 video stream,
expected dimensions, EDL duration within 1 second, and AAC presence matching
the source. Size is bounded and SHA-256 is stored.

