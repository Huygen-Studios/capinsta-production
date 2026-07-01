# Rate Limits And Quotas

## Current Controls

- Admin login uses Redis-backed limits by IP hash and normalized email hash.
- Admin mutation assertions are nonce-protected and single-use through Redis.
- Runtime policy enforces caption/export quotas and concurrent-job limits.
- Caption jobs and export jobs support idempotency keys and reject changed-payload key reuse.
- Backend protected mutation/read routes use Redis-compatible rate-limit hooks. Production fails closed when the distributed limiter is not configured.

## Production Defaults To Configure

- Login: 5 failed attempts per email identity per 15 minutes, 20-25 per IP per 15 minutes, 10 per device fingerprint per 15 minutes.
- Password reset: 3 per account identity per hour, 5 per IP per hour.
- Verification resend: 3 per account identity per hour.
- Signup: limit by IP and device fingerprint.
- Job polling: route-specific token bucket, higher for active editor sessions.
- Upload/export/transcription start: require authenticated user and quota checks.
- JSON bodies: `MAX_JSON_BODY_BYTES`, default `1048576`, rejected before route parsing with `413`.
- URL-encoded form bodies: `MAX_FORM_BODY_BYTES`, default `8388608`, rejected before route parsing with `413`.
- Multipart upload bodies: governed by `MAX_UPLOAD_SIZE_MB` plus small multipart overhead, then validated by upload-specific media checks.

Store rate-limit keys as HMACs of normalized emails. Do not store plaintext emails in Redis keys.

## Idempotency

Non-idempotent creation endpoints should require an idempotency key. Caption and export job idempotency is durable and scoped by user. Same key with the same normalized payload returns the existing job. Same key with a materially different payload returns `409`.

Caption job idempotency stores safe request metadata only: project ID, media asset ID or upload filename/type/size, language/output choices, provider/model/config version, timestamp strategy, and provider mode.

## Cursor Pagination

Versioned list endpoints return a stable envelope:

```json
{
  "items": [],
  "pagination": {
    "limit": 25,
    "hasMore": false,
    "nextCursor": null
  }
}
```

`GET /api/v1/jobs` and `GET /api/v1/export/jobs` use tenant-scoped ordering by `created_at DESC, id DESC`. Cursors are opaque and HMAC-signed with `PAGINATION_CURSOR_SECRET`. Default limit is 25 and maximum limit is 100. Legacy `/api/jobs` and `/api/export/jobs` calls without pagination parameters keep their previous list response shape for compatibility.
