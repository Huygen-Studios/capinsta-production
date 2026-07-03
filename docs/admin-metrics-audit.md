# Admin Metrics Audit

Date: 2026-07-03

## Current Dashboard Path

The admin overview page is `apps/web/src/app/admincapinsta11/(protected)/overview/page.tsx`.
Before this upgrade it called `getOverviewData()` from `apps/web/src/admin/data.ts`.

## Current Cards Before This Change

- Registered users: `public.profiles` total and profile-created counts.
- Caption jobs: `public.caption_jobs` status counts.
- Export jobs: `public.export_jobs` status counts.
- Projects: `public.project_registry` count, expiry count, and approximate bytes.
- Open support cases: `public.support_cases`.
- Backend: `BACKEND_INTERNAL_URL /health`.
- Caption/export reliability: completed counts divided by all recorded jobs.
- Activity windows: `profiles.last_seen_at`.
- Provider health: `public.provider_health_events`.
- Recent audit activity: `public.admin_audit_log`.

## Root Cause Of The False 0 User Count

The card label said "Registered users", but the query used `public.profiles`:

```ts
db.select({ total: count(), ... }).from(profiles)
```

The source of truth for account registration is Supabase Auth `auth.users`, not `profiles`.
Profiles can be missing, orphaned, backfilled later, blocked by trigger/RLS defects, or manually created without a real Auth identity. The old helper also caught query failures and returned a fallback object full of zeroes, so a failed privileged query was displayed exactly like a successful empty result.

Classification:

- Wrong table: yes, account registration was read from `profiles`.
- Missing privileged source query: yes, `auth.users` requires a server-only database path.
- Swallowed query error: yes, `overviewQuery()` returned zero fallbacks.
- Date-range ambiguity: yes, "7 days" was not labelled as rolling UTC.
- RLS/browser leakage: no browser service-role leakage was found in this path.

## Before And After Definitions

Before:

- Registered users = count rows in `profiles`.
- 7-day users = profiles created after `Date.now() - 7 days`.
- Failed source = zero.

After:

- New accounts = count rows in `auth.users` where `created_at >= start_utc AND created_at < end_utc`.
- Total accounts = count all rows in `auth.users`.
- Failed source = metric status `unavailable`, value `null`.
- Last 7 days = rolling last 7 x 24 hours in UTC.

## Historical Data Limits

Project, caption, export, donation, and entitlement metrics use existing authoritative tables and can report historical rows that already exist.
Upload completed/failed metrics use the new `product_events` ledger and become complete after migration/deployment. No blind historical upload backfill was added because the repository does not currently expose a verified Postgres media upload table in the web control-plane schema.

Website visitors are intentionally separate from accounts. They are only available when PostHog is configured; otherwise the dashboard shows them as unavailable.

## Verification

Implemented:

- Server-only `/api/admin/metrics` endpoint.
- `Cache-Control: no-store` and `dynamic = "force-dynamic"`.
- Per-metric status, source, definition, updated timestamp, generated timestamp, and UTC range metadata.
- UI warning state for partial failures.
- Tests for UTC range logic and failed-query behavior.

Validation run:

- `bunx tsc --noEmit --pretty false` passed after the Sentry sanitizer type correction.
- Targeted tests for metrics and sanitizers passed.
