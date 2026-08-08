# Capinsta administration control plane

The admin application is served at `/admincapinsta11`. The route name is not a security boundary. Server-rendered pages, route handlers, PostgreSQL RBAC, Supabase session validation, AAL2, recent-MFA checks, rate limits, RLS, and append-only audit records enforce access.

## Security and operational model

- Protected requests validate the Supabase session with `getUser()`, require an active `profiles` row, an active admin role, and AAL2.
- Sensitive mutations require an MFA verification from the previous ten minutes and a written reason.
- Next.js issues 45-second, action-scoped HMAC assertions containing issuer, audience, subject, permission, method, path, JTI, issued-at, not-before, expiry, and correlation ID.
- FastAPI rechecks the acting administrator and permission in PostgreSQL. Mutation JTIs are consumed once in Redis.
- FastAPI SQLite remains the live queue store. A durable SQLite outbox mirrors idempotent caption, export, usage, and project events into PostgreSQL. Failed deliveries retry, and the protected reconcile operation repairs missed or stale records.
- Audit records are append-only. RLS is enabled on all control-plane tables, and Data API access is revoked from `anon` and `authenticated`.
- Proxy headers are ignored unless `TRUSTED_PROXY_MODE` is explicitly `coolify` or `cloudflare`.

## PostgreSQL migration

Required extension: `pgcrypto`.

Use a staging database that is not production:

```powershell
$env:DATABASE_URL='postgresql://USER:PASSWORD@STAGING_HOST:5432/DATABASE?sslmode=require'
bun run --cwd apps/web db:migrate
bun run --cwd apps/web admin:verify-migration
```

Expected verifier output:

```json
{"ok":true,"tables":20,"roles":5,"permissions":29,"appendOnlyProtected":true,"finalAdminProtected":true,"jsonProtected":true}
```

`db:migrate` records hashes in `drizzle.drizzle_migrations`; rerunning it is safe and does not duplicate seed rows. Verify status with:

```sql
select count(*) from drizzle.drizzle_migrations;
select count(*) from admin_roles;       -- 5
select count(*) from admin_permissions; -- 29
select count(*) from pg_tables where schemaname='public' and rowsecurity;
```

Before migration, take a provider snapshot and a logical backup. The migration is additive; recovery is to restore the staging snapshot or database backup. Do not attempt an ad-hoc production down migration. If application deployment fails after the schema succeeds, roll the application containers back while retaining the additive schema.

## Initial administrator

1. Create the user in Supabase Auth.
2. Set `CAPINSTA_ADMIN_BOOTSTRAP_USER_ID` on the frontend runtime.
3. Run `bun run --cwd apps/web admin:bootstrap`.
4. Confirm the user enrolls TOTP and reaches AAL2.
5. Remove the bootstrap variable and redeploy the frontend.

There is no browser bootstrap or public recovery endpoint. MFA reset requires another recovery-capable administrator, fresh MFA, permission, a reason, session revocation, and forced re-enrollment.

## Coolify environment matrix

| Variable | Frontend | Backend | Temporary | Notes |
|---|---:|---:|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | Yes | Yes (`SUPABASE_URL`) | No | Same project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | No | No | Public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | No | No | Server runtime only; never `NEXT_PUBLIC_` |
| `DATABASE_URL` | Yes | Yes | No | PostgreSQL control plane |
| `ADMIN_DATABASE_URL` | No | Optional | No | Backend override for `DATABASE_URL` |
| `UPSTASH_REDIS_REST_URL` | Yes | Yes | No | Rate limits and assertion replay |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Yes | No | Server runtime only |
| `INTERNAL_ADMIN_API_SECRET` | Yes | Yes | No | Identical strong assertion key |
| `ADMIN_ASSERTION_ISSUER` | Yes | Yes | No | Identical issuer, default `capinsta-web` |
| `BACKEND_INTERNAL_URL` | Yes | No | No | Private FastAPI URL |
| `NEXT_PUBLIC_SITE_URL` | Yes | No | No | Public application origin |
| `TRUSTED_PROXY_MODE` | Yes | No | No | `coolify`, `cloudflare`, or `none` |
| `ADMIN_SECURITY_PEPPER` | Yes | No | No | At least 32 random bytes |
| `INTERNAL_MAINTENANCE_SECRET` | Yes | Yes | No | Due-deletion cleanup authorization |
| `COMMIT_SHA` | Yes | Yes | No | Displayed safely in system health |
| `CAPINSTA_ADMIN_BOOTSTRAP_USER_ID` | Yes | No | Yes | Remove after first bootstrap |

Provider keys, FFmpeg/FFprobe paths, Chromium/Playwright settings, SQLite volume paths, and export storage configuration remain backend-only.

Coolify variables are runtime values for both containers unless a Dockerfile explicitly consumes them during build. Any `NEXT_PUBLIC_*` value is embedded into the frontend bundle and therefore requires a rebuild/redeploy when changed. Redeploy both services after changing shared assertion, Redis, database, or Supabase values.

To rotate the assertion secret, set a new strong value on both services during one maintenance window, redeploy the backend and frontend, and verify admin operations. Existing assertions expire within 45 seconds. To rotate Upstash, update both services, redeploy, and confirm rate limiting plus replay tests; old temporary blocks do not migrate automatically.

## Staging-first release

1. Back up PostgreSQL and the FastAPI SQLite/runtime volume.
2. Configure staging variables using separate Supabase, PostgreSQL, Redis, storage, and test users.
3. Apply and verify the migration.
4. Deploy FastAPI, then Next.js.
5. Bootstrap the staging super-admin, enroll MFA, remove the bootstrap variable, and redeploy.
6. Provision isolated normal, suspended, support, operations, analyst, and super-admin E2E users.
7. Run backend, frontend, migration, RLS, assertion replay, mirror, and authenticated Playwright tests.
8. Exercise caption creation, export creation, cancellation, retry, reconciliation, retention cleanup, support workflows, feature flags, quotas, security unblock, and audit visibility.
9. Repeat the additive migration and deployment sequence in production only after staging passes.

Due user deletions are executed with:

```powershell
bun run --cwd apps/web admin:execute-due-deletions
```

Schedule it in a protected Coolify cron job. It minimizes profile PII after Supabase deletion while preserving required audit/security records.
