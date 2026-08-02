# Stage 5 tracking

Status: implementation in progress; external launch gates remain blocked.

Implemented locally: dedicated Clipper entitlement, Whop OAuth and authenticated
idempotent webhooks, additive migration 0026, atomic candidate-regeneration
reservation, trusted-proxy rate limiting, emergency controls, DB-aware
readiness, bounded retention cleanup for source media, variants, exports,
uploads, handoffs, reservations, webhooks, idempotency records, and temporary
workspaces, durable account deletion, environment/Compose
configuration, tests, and production runbooks.

Docker verification on 2026-07-27: Docker Desktop recovered and a disposable
PostgreSQL 17 container verified migration 0026, RLS, and quota admission.
The worker now reuses the backend image, avoiding the prior duplicate export.
The final `web`/`backend` Linux build was retried with plain BuildKit progress,
but Docker produced no output and exceeded the ten-minute command bound; the
new image startup, in-container `/render` Chromium check, and worker-start
check therefore remain blocked by this host build behavior. Earlier image
smoke results are not treated as final-image verification.

External blockers: no Whop app/product/webhook credentials, real Supabase
staging credentials, Coolify builder, or production domain configuration are
present. Therefore real Supabase/Whop, Coolify, and real staging workflow
verification cannot yet be claimed.

Production publication update (2026-07-28): the authoritative local tree is on
`production/automatic-clipper` with a timestamped safety branch and patch.
Linux GHCR build/smoke/deploy automation, the external-Supabase Coolify
topology, guarded migration runner, 90-minute/2-GiB source limits, direct TUS
retry/resume behavior, and range-based proxy playback are prepared. Deployment
remains gated on the GitHub environment values and Coolify/Supabase/provider
credentials documented in `docs/production/coolify-deployment.md`; no URL is
considered verified until that workflow passes.

Large-upload hardening update (2026-07-29): additive migration `0027` restores
the private `source-media` bucket file-size limit to `2147483648` bytes without
editing released migration `0015`. The TUS browser boundary now creates the
resumable upload with an empty POST and sends all media bytes through bounded
PATCH chunks. Supabase's project-global Storage limit remains an external
manual setting in Supabase Dashboard -> Storage -> Settings -> Global file size
limit; doctor reports it as unverified rather than assuming it matches the
bucket.

R2 storage update (2026-07-29): additive migration `0028` adds persisted
`storage_provider` plus R2 multipart metadata. New production Clipper uploads
use private Cloudflare R2 buckets through backend-signed multipart part URLs;
existing Supabase-backed rows keep `storage_provider='supabase'` and remain
readable. The browser no longer sends large source-video chunks to Supabase
Storage when `CLIPPING_STORAGE_PROVIDER=r2`.

Editor-first manual Clipper update (2026-08-02): additive migration `0032`
introduces owner-scoped clip batches, independent three-minute source ranges,
child-project materialization, range-only sequential captions, normal editable
headings, edited-project synchronization, and private selected/all ZIP exports.
The default `/clipper` route uses this editor-first flow; the existing automatic
workflow remains at `/clipper/automatic`. No new environment variable is needed.
