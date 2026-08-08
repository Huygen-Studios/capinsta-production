# Admin Metric Definitions

All range-based filters use UTC timestamps with inclusive start and exclusive end:

```sql
timestamp_column >= start_utc
AND timestamp_column < end_utc
```

Supported presets:

- Last 24 hours: rolling last 24 hours.
- Last 7 days: rolling last 7 x 24 hours.
- Last 30 days: rolling last 30 x 24 hours.

## Acquisition

- Website visitors: distinct PostHog `$pageview` visitors for the selected range, queried by the server. Unavailable when `POSTHOG_PROJECT_ID` or `POSTHOG_PERSONAL_API_KEY` is not configured.
- New accounts: `auth.users.created_at` rows created in range.
- Total accounts: all rows in `auth.users`.

## Product Usage

- Active creators: distinct authenticated users from `project_registry`, `caption_jobs`, `export_jobs`, and relevant `product_events` rows in range.
- Projects created: `project_registry.created_at` rows in range.
- Uploads completed: `product_events.event_name = 'media_upload_completed'` in range.
- Uploads failed: `product_events.event_name = 'media_upload_failed'` in range.
- Caption jobs started: `caption_jobs.created_at` rows in range.
- Caption jobs completed: `caption_jobs.completed_at` rows with status `completed` or `succeeded` in range.
- Caption jobs failed: `caption_jobs.completed_at` rows with status `failed` in range. `completed_at` is the terminal timestamp for failed caption jobs.
- Exports started: `export_jobs.created_at` rows in range.
- Exports completed: `export_jobs.completed_at` rows with status `completed` or `succeeded` in range.
- Exports failed: `export_jobs.completed_at` rows with status `failed` in range. `completed_at` is the terminal timestamp for failed export jobs.
- Median caption duration: median `completed_at - started_at` seconds for completed caption jobs.
- Median export duration: median `completed_at - started_at` seconds for completed export jobs.

## Business

- Users with active access: distinct users in `app_product_entitlements` with `granted`, `active`, or `approved` status and no expiry in the past.
- Waitlist: `profiles.product_access_status` in `pending`, `waitlist`, or `requested`.
- Private Server requests: `private_server_requests.created_at` rows in range.
- Successful donations: verified `donations.status = 'paid'` rows in range.
- Failed donations: `donations.status = 'failed'` rows in range.
- Refunds: `donations.status = 'refunded'` rows in range.
- Donation total: sum of `donations.amount_inr` for verified paid donations in range.

## Reliability

- Last successful caption job: minutes since latest successful `caption_jobs.completed_at`.
- Last successful export: minutes since latest successful `export_jobs.completed_at`.
- Caption failure rate: failed caption jobs divided by all caption jobs created in range.
- Export failure rate: failed export jobs divided by all export jobs created in range.

## Failure Semantics

A metric query failure must return:

- `status: "unavailable"`
- `value: null`
- a safe error code in the response-level `errors` list

Unavailable data must never be rendered as zero.
