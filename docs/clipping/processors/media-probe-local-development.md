# Media probe local development

FFprobe must be installed before the worker starts:

```text
ffprobe -version
```

The backend image already installs the Debian `ffmpeg` package. Locally, keep
`FFPROBE_BINARY=ffprobe` or set an absolute trusted executable path.

The handler is off by default. Supabase-backed development requires:

```text
ENABLE_DURABLE_PROCESSING_WORKER=true
ENABLE_MEDIA_PROBE_HANDLER=true
ENABLE_SUPABASE_MEDIA_STORAGE=true
MEDIA_PROBE_STORAGE_BACKEND=supabase
```

Provide existing Supabase values through the normal secret store. Never commit
them. An explicit local adapter uses:

```text
MEDIA_PROBE_STORAGE_BACKEND=local
MEDIA_PROBE_LOCAL_STORAGE_ROOT=C:/absolute/private/development/root
```

Job input still contains only asset and revision identifiers. Local paths are
derived inside the root-confined storage adapter.

Start the worker with `python -m server.clipping_jobs.worker`. Focused tests
are `python -m pytest -q tests/test_media_probe.py` and
`python -m pytest -q tests/test_media_probe_postgres.py`. The PostgreSQL suite
requires `CLIPPING_PERSISTENCE_TEST_DATABASE_URL` pointing to a disposable
database whose name contains `test`.

