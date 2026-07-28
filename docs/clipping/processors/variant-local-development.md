# Media variant local development

Install FFmpeg and FFprobe and ensure both are on `PATH`. Start a disposable
PostgreSQL 17 database, apply migrations `0014` through `0018`, then configure:

```env
ENABLE_DURABLE_PROCESSING_WORKER=true
ENABLE_MEDIA_VARIANT_HANDLERS=true
MEDIA_VARIANT_STORAGE_BACKEND=local
MEDIA_VARIANT_LOCAL_STORAGE_ROOT=C:/absolute/private-media-root
MEDIA_VARIANT_TEMP_ROOT=C:/absolute/private-variant-temp
```

Local Storage is an explicit development adapter. Production uses private
Supabase Storage with backend-only service credentials. Keep the temp root on
a private volume with enough free space and conservative worker concurrency.

Focused tests:

```text
python -m pytest -q tests/test_media_variants.py
python -m pytest -q tests/test_media_variants_postgres.py
```

The PostgreSQL suite requires `CLIPPING_PERSISTENCE_TEST_DATABASE_URL` whose
database name contains `test`. Real media tests generate short synthetic input
and require no network.
