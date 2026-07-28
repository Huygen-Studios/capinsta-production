# Production environment

Public build variables are limited to the site URL, Supabase URL/anon key, and
documented `NEXT_PUBLIC_*` UI flags. Never expose service-role, Whop, database,
render-token, maintenance, or rate-limit secrets.

Stage 5 server variables are `ENABLE_WHOP_ACCESS`, `WHOP_APP_ID`,
`WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_PRODUCT_ID`,
`ENABLE_USAGE_QUOTAS`, `ENABLE_RETENTION_CLEANUP`,
`ENABLE_ACCOUNT_DELETION`, `DISABLE_NEW_UPLOADS`,
`DISABLE_CANDIDATE_ANALYSIS`, `DISABLE_CLIPPING_EXPORTS`, retention periods,
trusted origins, and `TRUSTED_PROXY_MODE`.

`PRIVATE_BETA_MAX_USERS`, `PRIVATE_BETA_ALLOWLIST`,
`ACCOUNT_DELETION_RECENT_AUTH_SECONDS`, and the documented
`PRIVATE_BETA_MAX_*` processing/storage limits are server-only controls.

Canonical long-source limits are `MAX_SOURCE_FILE_BYTES` (2 GiB),
`MAX_SOURCE_DURATION_SECONDS` (5400), `MAX_ACTIVE_UPLOADS_PER_USER` (2),
`MAX_ACTIVE_PROCESSING_JOBS_PER_USER` (2),
`MAX_PROCESSING_MINUTES_PER_PERIOD` (180),
`MAX_STORED_SOURCE_BYTES` (10 GiB), and `MAX_STORED_EXPORT_BYTES` (10 GiB).
Legacy `PRIVATE_BETA_*` names remain compatibility fallbacks. The Supabase
project global Storage limit must be at least the configured source limit.

Defaults deny new expensive work. Rotate Whop/API/webhook secrets and Supabase
service keys through Coolify secrets, then redeploy affected server roles.
