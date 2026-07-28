# Capinsta project handoff architecture

Stage 3.2 turns one current `CapinstaProjectConversionResultV1` into a normal
editable browser project. The FastAPI service prepares a short-lived,
owner-scoped `CapinstaProjectHandoffManifestV1`; `/editor/handoff/{handoffId}`
claims it, stores the unmodified v35 project and safe media descriptors, marks
the local import complete, then records server completion and redirects to the
normal editor route.

The durable row is bound to the authenticated user, clip project ID and
revision, conversion-result identity, target project ID, schema version, and
options through a canonical SHA-256 request identity. PostgreSQL advisory
locking and a partial unique index collapse equivalent concurrent preparation.
Claims and completions lock the row. Preparation and completion are
idempotent; a failed browser import is never reported complete.

The manifest is portable. It contains stable media IDs but no signed URL,
bucket, object path, local path, access token, service credential, or worker
data. Media access is a separate authenticated request. The source clipping
project, conversion result, and media asset are not mutated by claim,
completion, cancellation, or expiration.

Prepared and claimed handoffs expire at the database timestamp. There is no
post-claim grace period: completion after expiration is rejected. Expiration
does not invalidate conversion data; a fresh handoff can be prepared.

