# Local worker development

Apply the authoritative SQL migrations through the existing Drizzle stream:

```bash
cd apps/web
bun run db:migrate
```

Keep `ENABLE_DURABLE_PROCESSING_WORKER=false` for ordinary API development.
For an explicitly configured disposable database:

```bash
cd backend
set ENABLE_DURABLE_PROCESSING_WORKER=true
python -m server.clipping_jobs.worker
```

The environment variable names and safe defaults are in `.env.example`.
`PROCESSING_JOB_HEARTBEAT_SECONDS` must be lower than
`PROCESSING_JOB_LEASE_SECONDS`.

Run unit and real PostgreSQL verification:

```bash
python -m pytest tests/test_clipping_jobs.py
set CLIPPING_PERSISTENCE_TEST_DATABASE_URL=postgresql://.../capinsta_jobs_test
python -m pytest tests/test_clipping_jobs_postgres.py
```

The integration test refuses to reset a database whose name does not contain
`test`. It applies migrations `0014`–`0016` to empty schemas and uses multiple
real connections for claim races and crash recovery.

