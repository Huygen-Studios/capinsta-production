# Plans, quotas, and usage

Private beta uses existing admin/internal, beta, and paid entitlement controls.
`user_quotas` and centralized `system_settings` remain policy authorities.
`usage_events` remains the committed audit ledger; `usage_reservations` adds
atomic, idempotent admission for expensive operations.

Candidate regeneration uses a per-user PostgreSQL advisory transaction lock.
Retries reuse the reservation, success commits it, and a failed enqueue
releases it. Expired reservations are released by scheduled cleanup.

When `ENABLE_USAGE_QUOTAS=true`, Clipper project admission also limits source
file size and duration, active processing jobs, daily processing minutes, and
stored source bytes. Export admission limits concurrent exports and stored
export bytes. The `PRIVATE_BETA_*` environment values are server-only and have
safe small defaults in the example files; use `0` only to deliberately block a
category. `PRIVATE_BETA_ADMIN_USER_IDS` is the explicit server-only override
for internal operators. Existing caption/export duration and concurrency limits
remain active.

Commercial values belong in settings/environment, not endpoint code.

## Source media size limits

Production source uploads use direct browser-to-Supabase TUS uploads. The app
limit is `MAX_SOURCE_FILE_BYTES` and defaults to `2147483648` bytes (2 GiB).
The `source-media` bucket `file_size_limit` is kept at the same value by
migration `0027`.

Supabase also has a project-global Storage file size limit:

```text
Supabase Dashboard -> Storage -> Settings -> Global file size limit
```

Set that global limit to at least the largest source video Capinsta should
accept. For 30-60 minute videos, use at least 2 GB if the Supabase plan allows
it. Free Supabase projects can have a much smaller effective maximum and are
not suitable for typical long source videos.

The bucket limit cannot exceed the project-global limit. TUS chunk size does
not bypass the global file-size limit; it only bounds each PATCH request body.
