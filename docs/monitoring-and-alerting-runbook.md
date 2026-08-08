# Monitoring And Alerting Runbook

## Stable Health Endpoints

- `GET /health/live`: web process liveness. Does not check database or third-party providers.
- `GET /health/ready`: web readiness. Checks PostgreSQL and backend readiness with sanitized dependency status.
- `GET /api/health`: compatibility liveness summary.
- Backend `GET /health/ready`: FastAPI readiness.
- Backend `GET /health`: diagnostic backend health summary.

## Better Stack Uptime

Create monitors:

1. Homepage: `https://capinsta.huygenstudios.com/`, expected `200`.
2. Web liveness: `https://capinsta.huygenstudios.com/health/live`, expected `200`.
3. Web readiness: `https://capinsta.huygenstudios.com/health/ready`, expected `200`.
4. Backend readiness if public: `https://api.capinsta.huygenstudios.com/health/ready`, expected `200`.

Recommended alerts:

- 2 consecutive failures for liveness.
- 3 consecutive failures for readiness.
- Email plus Slack/Telegram if available.

## PostHog Setup

Required only for visitor/acquisition analytics.

Environment variables:

- `NEXT_PUBLIC_POSTHOG_KEY`: public project token used only by the browser SDK.
- `NEXT_PUBLIC_POSTHOG_HOST`: browser capture host. Production should use `https://g.huygenstudios.com`.
- `POSTHOG_PROJECT_ID`: server-only PostHog project id for admin visitor metrics.
- `POSTHOG_PERSONAL_API_KEY`: server-only personal API key with the minimum read access needed for analytics queries.
- `POSTHOG_API_HOST`: server-side PostHog API host, normally `https://us.posthog.com`.

Privacy:

- Session replay is disabled in code.
- Autocapture is disabled in code.
- Analytics capture only starts after analytics cookie consent.
- User identity is Supabase user ID only, never email.

Verification:

1. Open PostHog Live Events.
2. Visit the landing page after accepting analytics cookies.
3. Confirm `landing_page_viewed` appears with `pathname` only.

Rollback:

- Remove `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, and `POSTHOG_PERSONAL_API_KEY`, then redeploy. Visitor cards will show `Unavailable`; account and product metrics remain available.

## Sentry Setup

Environment variables:

- `NEXT_PUBLIC_SENTRY_DSN`: optional browser DSN.
- `SENTRY_DSN`: optional server DSN.

Optional CI-only variables:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

Do not expose CI upload tokens to the browser.

Sanitization:

- Authorization headers, cookies, tokens, Supabase data, payment data, captions, transcripts, media URLs, signed URLs, and emails are filtered before send.

Verification:

1. Configure DSN in staging.
2. Trigger a safe development-only test event or inspect initialization logs.
3. Confirm the Sentry event has no cookies, auth headers, captions, transcripts, payment payloads, or signed URLs.

Rollback:

- Remove Sentry DSN variables and redeploy.

## Admin Dashboard Troubleshooting

If a metric shows zero:

1. Check the metric status. A failed query must show `Unavailable`, not zero.
2. Open `/api/admin/metrics?range=7d` as an admin.
3. Confirm `range.startUtc`, `range.endUtc`, and `generatedAt`.
4. Confirm the metric `source` and `definition`.
5. Check server logs for `admin_metric_query_failed`.
6. For account counts, verify directly in Supabase SQL:

```sql
select count(*) from auth.users;
select count(*) from auth.users
where created_at >= now() - interval '7 days'
  and created_at < now();
```

7. For product access, verify:

```sql
select count(distinct user_id)
from public.app_product_entitlements
where status in ('granted','active','approved')
  and (expires_at is null or expires_at > now());
```

## Alert Threshold Suggestions

- `/health/live` unavailable: urgent.
- `/health/ready` unavailable for 3 checks: urgent.
- Caption failure rate above 20% for 30 minutes: investigate providers/storage.
- Export failure rate above 15% for 30 minutes: investigate FFmpeg/Playwright/storage.
- New accounts unavailable: inspect database credentials and Auth schema access.
- Payment webhook failures: inspect Razorpay dashboard and `payment_events`.

## Deployment Verification

1. Apply migrations through the existing Supabase migration process.
2. Deploy web and backend.
3. Open `/health/live`.
4. Open `/health/ready`.
5. Sign in as an admin.
6. Open `/admincapinsta11/overview`.
7. Confirm new accounts source is `auth.users.created_at`.
8. Confirm failed/unconfigured visitor metrics show `Unavailable`, not zero.
