# Product Analytics Event Catalog

CapInsta now has a durable server-side ledger table: `public.product_events`.

The ledger is for operational reporting. It is not a raw analytics dump and must not contain captions, transcripts, filenames, signed URLs, tokens, cookies, payment secrets, or full email addresses.

## Required Event Names

- `signup_completed`
- `project_created`
- `media_upload_completed`
- `media_upload_failed`
- `caption_job_started`
- `caption_job_completed`
- `caption_job_failed`
- `export_started`
- `export_completed`
- `export_failed`
- `private_server_request_submitted`
- `donation_completed`
- `donation_failed`
- `donation_refunded`

## Ledger Fields

- `id`: UUID primary key.
- `event_name`: one of the allowed event names.
- `occurred_at`: UTC event time.
- `user_id`: nullable Auth user ID.
- `project_id`: nullable project ID.
- `media_asset_id`: nullable media asset ID.
- `caption_job_id`: nullable caption job ID.
- `export_job_id`: nullable export job ID.
- `environment`: deployment environment.
- `event_key`: idempotency key, unique.
- `metadata`: sanitized JSON only.
- `created_at`: UTC insert time.

## Current Emitters

- `signup_completed`: trigger on `auth.users`.
- `project_created`: trigger on `project_registry`.
- `caption_job_started`, `caption_job_completed`, `caption_job_failed`: trigger on `caption_jobs`.
- `export_started`, `export_completed`, `export_failed`: trigger on `export_jobs`.
- `private_server_request_submitted`: server route after successful request insert.
- `donation_completed`, `donation_failed`, `donation_refunded`: Razorpay webhook processing after verified local state update.

## Historical Coverage

Existing project/job/export tables remain the source for historical dashboard metrics.
The ledger is complete only for events after migration deployment unless a verified backfill is written later.

## Optional PostHog Mirror

PostHog is for visitors, funnels, and non-sensitive product behavior. It is not authoritative for accounts, payments, entitlements, exports, or revenue.

Frontend PostHog events should use stable user IDs after login and anonymous IDs before login. Do not identify users by email.

Allowed public events include:

- `landing_page_viewed`
- `cta_clicked`
- `signup_started`
- `signup_completed`
- `login_completed`
- `editor_opened`
- `video_upload_started`
- `video_upload_completed`
- `caption_generation_requested`
- `caption_generation_completed`
- `caption_generation_failed`
- `export_requested`
- `export_completed`
- `export_downloaded`
- `donation_checkout_started`
- `donation_completed`

Session replay stays disabled unless explicitly approved and covered by privacy policy/consent updates.
