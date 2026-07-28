# Local clipping API development

All rollout flags default to false:

```env
ENABLE_CLIPPING_PROJECT_API=true
ENABLE_RECOMMENDATION_DECISIONS=true
ENABLE_ACCEPTED_RECOMMENDATION_DRAFTS=true
ENABLE_PROJECT_DERIVATION_REQUESTS=true
ENABLE_PROJECT_CONVERSION_REQUESTS=true
```

Limits use `CLIPPING_PROJECT_MAX_RANGES`,
`CLIPPING_RECOMMENDATION_DECISION_BATCH_MAX`,
`CLIPPING_DRAFT_RECOMMENDATION_MAX`, and
`CLIPPING_PROJECT_PAGE_SIZE_MAX`. Apply migrations through `0021` and use a
valid Supabase bearer token. Durable job creation does not imply Rust
execution.

```powershell
$env:PYTHONPATH='backend'
python -m pytest backend/tests/test_clipping_orchestration.py backend/tests/test_clipping_project_api.py -q
$env:CLIPPING_PERSISTENCE_TEST_DATABASE_URL='postgresql://.../name_containing_test'
python -m pytest backend/tests/test_clipping_orchestration_postgres.py -q
python -m compileall -q backend
bun x tsc --noEmit
```

The PostgreSQL suite resets its disposable database and refuses names without
`test`.
