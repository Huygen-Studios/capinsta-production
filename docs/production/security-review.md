# Production security review

- Supabase authentication and centralized permission checks protect clipping.
- `/clipper` and `/api/clipping/*` require the dedicated `clipper` entitlement.
- New tables use RLS; browser users have no authoritative writes.
- Whop OAuth establishes identity and webhook HMAC authenticates events.
- CORS is exact in production; forwarded IPs are trusted only in configured
  Coolify/Cloudflare proxy mode.
- Body, upload, metadata, pagination, signed-URL TTL, and rate limits remain
  bounded.
- Service-role, Whop, DB, render, and maintenance secrets are server-only.
- Emergency controls deny new uploads, analysis, and exports while reads remain.

Before beta, scan built frontend assets for secret values and verify every
Supabase bucket is private.
