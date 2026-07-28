# Durable clipping persistence architecture

Capinsta uses Supabase Auth identities, Supabase-hosted Postgres, and private
Supabase Storage object references. The existing web app already creates
Supabase browser/server clients, while FastAPI verifies Supabase JWTs directly.
Trusted persistence operations use the existing `psycopg` dependency and
`ADMIN_DATABASE_URL` (falling back to `DATABASE_URL`) because project updates,
job transitions, and idempotent job creation require real transactions.

The browser has read-only RLS access to its own durable clipping rows. It cannot
write contracts or server-managed job/storage fields directly. FastAPI creates
an `AuthenticatedActor` from an already verified JWT and includes that actor's
user ID in every ownership predicate. The Postgres service role remains
server-only and bypasses RLS; repositories still enforce actor ownership so
service credentials do not turn a request body into authority.

`TranscriptDocumentV2`, `ClipProjectV1`, and Stage 1 derived contracts remain
the JSON source of truth. FastAPI validates them before JSONB writes, while
database checks protect row/document IDs, schema versions, revisions, media
IDs, non-negative units, and ownership chains.

The current SQLite caption/export runtime and endpoints remain unchanged.
`ENABLE_SUPABASE_DURABLE_JOBS=false` is the default. Enabling it makes the new
repository boundary constructible for future integration; this task adds no
worker, route switch, upload, export, ASR, VAD, or Rust invocation.

Storage bytes never enter these tables. Task 2.2 now adds private Supabase
Storage orchestration, durable upload sessions, verified attachment, signed
preview/download access, versioned replacement, and recoverable deletion.
Only private bucket names and relative object paths are persisted; signed
URLs and upload tokens remain ephemeral. See
`docs/clipping/storage/supabase-storage-architecture.md`.
