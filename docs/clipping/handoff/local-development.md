# Handoff local development

Enable both backend gates:

```env
ENABLE_CAPINSTA_PROJECT_HANDOFF=true
ENABLE_SERVER_BACKED_EDITOR_MEDIA=true
```

Enable the matching public UI gates:

```env
NEXT_PUBLIC_ENABLE_CAPINSTA_PROJECT_HANDOFF=true
NEXT_PUBLIC_ENABLE_SERVER_BACKED_EDITOR_MEDIA=true
```

Apply migration `0023_capinsta_project_handoffs.sql`. The API runs in the
existing FastAPI service; no new worker or service-role browser configuration
is required. Configure private Supabase storage exactly as described by the
existing storage docs.

Focused checks:

```text
cd backend
PYTHONPATH=..;. python -m pytest tests/test_clipping_handoff.py

cd apps/web
bun test src/services/clipping-handoff src/services/server-backed-media
bun x tsc --noEmit
```

Set `CLIPPING_PERSISTENCE_TEST_DATABASE_URL` to a disposable PostgreSQL 17
database for integration/RLS tests. Never point those tests at a non-test
database. Real Supabase network verification is optional and must be reported
separately from mocked signing tests.

