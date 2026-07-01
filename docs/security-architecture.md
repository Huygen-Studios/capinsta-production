# Security Architecture

## Trust Boundaries

- Browser: untrusted. All upload type, auth, ownership, and quota checks are enforced server-side.
- Next.js app: handles Supabase session UX, admin assertion signing, API proxying, and security headers.
- FastAPI backend: validates authenticated CapInsta API calls, owns local media/export storage, and queues heavy caption/export work.
- Workers/media tools: FFmpeg, FFprobe, VAD, Stable-ts, and render work must run with bounded runtime, disk, CPU, and memory in production.
- Redis/Postgres/Supabase: private network or managed private endpoints only.

## Auth And Sessions

- Backend API requests require Supabase bearer tokens on protected prefixes.
- Admin backend calls require short-lived HMAC assertions bound to method, path, permission, AAL2, and nonce.
- Cookie-authenticated state-changing Next.js routes require same-origin evidence using `Origin`, `Referer`, or Fetch Metadata. Cross-site requests and cookie requests without origin evidence are rejected before body parsing.
- Failed login UI maps provider differences to `Incorrect email or password.`
- Reset flows use generic copy: `If an eligible account exists, instructions have been sent.`

## Request Validation

- Sensitive dynamic JSON option fields are recursively bounded by depth, key count, array length, and string length.
- Client-provided JSON keys beginning with `$` or containing `.` are rejected to prevent NoSQL/operator-style payloads from entering provider/config logic.
- Multipart media uploads stay on the dedicated upload validator path so large video/audio/image bodies are not buffered by generic JSON validation.

## Clipboard Safety

- Browser clipboard writes happen only from explicit UI actions.
- Text copied to the system clipboard is sanitized to remove bidi/invisible controls and unsafe ASCII controls.
- Common bearer/JWT tokens, secret assignments, and signed URL query parameters are redacted before writing clipboard text.

## Script Injection Controls

- User-facing text is rendered as React text by default.
- JSON-LD structured-data scripts use escaped JSON serialization for `<`, `>`, `&`, and Unicode line/paragraph separators before assigning `dangerouslySetInnerHTML`.
- Inline analytics bootstrap code contains no interpolated user data; dynamic analytics consent state is sent through `gtag` calls after load.

## Error Handling

Backend framework exceptions are wrapped as:

```json
{"error":{"code":"not_found","message":"The requested resource was not found.","requestId":"req_..."}}
```

Do not log or return passwords, tokens, cookies, authorization headers, provider keys, signed URLs, or filesystem internals.

## API Versioning And Pagination

`/api/v1` aliases expose versioned contracts without removing existing `/api` routes. Growing user lists use tenant-scoped cursor pagination ordered by `created_at DESC, id DESC`; cursors are HMAC-signed and must not be interpreted by clients.

## Timing Invariants

Estimated word timing is telemetry only. Blocking timing failures remain invalid ranges, overlaps, ordering problems, duplicate tokens, hard-boundary crossing, and required VAD/stable-ts failures.
