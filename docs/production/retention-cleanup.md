# Retention and cleanup

Run these private Coolify scheduled commands:

```text
python -m server.production.cleanup --dry-run
python -m server.production.cleanup --batch-size 500
python -m server.production.account_deletion --dry-run
python -m server.production.account_deletion --batch-size 10
```

Production cleanup uses bounded batches and supports dry-run. It expires
unfinished upload sessions, handoffs, reservations, webhook events, and
idempotency records. It deletes expired source-media (including variants) only
when no active project or job references it, and deletes expired ready exports
only when their job is inactive. Storage is deleted before the corresponding
database state changes; missing objects are safe and provider failures leave
the record retryable. `SOURCE_MEDIA_RETENTION_DAYS`, `EXPORT_RETENTION_DAYS`,
and `TEMP_WORKSPACE_RETENTION_HOURS` control the windows.

Account cleanup separately deletes exact database-recorded objects before the
Auth record, and the worker cleanup removes only old immediate child workspace
directories under `AUTOMATIC_CLIPPER_TEMP_ROOT`.
