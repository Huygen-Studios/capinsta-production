# Local durable-persistence development

Required variable names:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_DATABASE_URL
ENABLE_SUPABASE_DURABLE_JOBS
CLIPPING_PERSISTENCE_TEST_DATABASE_URL
```

Never commit their real values. `CLIPPING_PERSISTENCE_TEST_DATABASE_URL` must
point to a disposable database: the integration test resets its `public` and
`auth` schemas.

This repository does not use a Supabase CLI migration directory. Its existing
authoritative path is Drizzle SQL under `apps/web/migrations`; use the normal
web database command:

```bash
cd apps/web
bun run db:migrate
```

For focused validation against a disposable Supabase-compatible Postgres:

```bash
cd backend
python -m pytest tests/test_clipping_persistence.py tests/test_clipping_persistence_postgres.py
```

The Postgres test supplies minimal local `auth.users`, `auth.uid()`,
`authenticated`, `anon`, and bypass-RLS `service_role` equivalents, applies
the real migration, then tests repositories and RLS. This is test-only
bootstrap code and is not a replacement for Supabase Auth.

If the Supabase CLI is added later, adopt it by migrating the existing
authoritative history as one planned change; do not run two competing streams.
`supabase start`, `supabase db reset`, and `supabase db push` are therefore not
current repository commands.
