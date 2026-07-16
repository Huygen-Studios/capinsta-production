# Production Hardening

This repository now contains application-side controls for safer production operation. External infrastructure such as CDN/WAF/firewall/database provisioning still must be deployed in the target environment.

## Implemented In Repo

- Backend request IDs and security headers on FastAPI responses.
- Structured backend error envelopes for framework HTTP and validation errors.
- Application-layer request body-size limits for JSON and form requests, with media uploads governed by the upload-size policy.
- Production CORS defaults that do not allow localhost unless explicitly configured outside production.
- Same-origin CSRF protection for cookie-authenticated Next.js state-changing routes, including admin, feedback, and the CapInsta proxy.
- Backend dynamic JSON option validation rejects NoSQL/operator-shaped keys such as `$where` and dotted keys before business logic runs.
- JSON-LD structured-data scripts use HTML-safe JSON serialization to prevent script-tag breakout from future dynamic text.
- Clipboard text writes strip bidi/invisible controls and redact common token, secret, and signed-URL patterns before copying.
- Upload filename, extension, declared MIME, magic-byte, image-dimension, and FFprobe validation.
- Safe image asset support for PNG, JPEG, WEBP, and GIF. SVG/XML/HTML/script/archive/executable formats are rejected.
- Export idempotency conflict detection for reused keys with changed payloads.
- Caption job idempotency conflict detection for duplicate transcription starts.
- `/api/v1` aliases for backend API routes while preserving existing `/api` compatibility.
- Signed cursor pagination for versioned caption-job and export-job list endpoints.
- Password UX policy for new passwords: 6 character minimum with at least one number and one symbol, 128 character hard maximum, no truncation.
- Generic user-facing login errors to reduce account enumeration.
- Caption timing preservation: estimated timing remains telemetry only; structural timing failures remain blocking.

## Production Gates

Before deployment:

1. Set all variables from `.env.example` with real secrets in the deployment secret store.
2. Run backend tests for auth, uploads, exports, timing, storage, and health.
3. Run frontend focused auth/config/caption tests.
4. Run a production web build with valid-length secret placeholders or real deployment secrets.
5. Verify `/health`, `/health/ready`, `/api/health`, and backend `/api/health/ready` through the reverse proxy.
6. Confirm storage directories are outside any public web root and mounted noexec where the platform supports it.

## Incident Rollback

1. Disable new traffic at the load balancer or CDN.
2. Roll back the web/backend image to the previous known-good tag.
3. Keep Redis/Postgres data; do not truncate idempotency/rate-limit data during an active incident.
4. Re-run health/readiness checks before restoring traffic.
5. Preserve logs with request IDs for investigation.
