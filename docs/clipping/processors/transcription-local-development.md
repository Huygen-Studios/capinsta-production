# Durable transcription local development

The handler and durable worker are both opt-in. For a local-storage worker:

```env
ENABLE_DURABLE_PROCESSING_WORKER=true
ENABLE_DURABLE_TRANSCRIPTION_HANDLER=true
TRANSCRIPTION_STORAGE_BACKEND=local
CLIPPING_LOCAL_STORAGE_ROOT=data/clipping-storage
TRANSCRIPTION_TEMP_ROOT=data/transcription-worker
PROCESSING_WORKER_MAX_CONCURRENCY=1
```

Configure `ADMIN_DATABASE_URL`, one active transcription configuration, and
only that provider's established backend credential. Do not place live
credentials in example files. With Supabase, enable the existing media-storage
configuration and service-role secret instead of local storage.

Useful checks:

```bash
python -m compileall -q backend
python -m pytest backend/tests/test_durable_transcription.py -q
python -m pytest backend/tests/test_durable_transcription_postgres.py -q
```

The PostgreSQL suite requires
`CLIPPING_PERSISTENCE_TEST_DATABASE_URL` pointing to a disposable PostgreSQL
17 database whose name contains `test`; it resets the schema. Unit tests use
fake provider results and no live credential. Live external-provider and real
Supabase smoke tests are optional, must use explicit development credentials,
and are not implied by mocked verification.

Temporary capacity must cover the ready WAV plus existing provider chunk and
intermediate output behavior. The default source limit is 2 GB and provider
output bound is 64 MB. Prefer transcription worker concurrency one until CPU,
memory, disk, and provider-rate behavior are measured.
