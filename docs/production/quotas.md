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
