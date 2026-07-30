# Monitoring

Use existing structured logs, sanitized Sentry events, admin metrics, provider
health, product events, and processing-job tables. Alert on readiness failure,
oldest queued age, failure/retry rate, lease recovery, upload/provider/export
failures, Whop failures, quota denials, and cleanup/deletion failures.

Logs may include stable resource IDs and safe counts. They must never include
transcripts, prompts, provider responses, signed URLs, tokens, secrets, local
paths, webhook bodies, or project JSON.

Inspect one upload failure by its safe request ID:

```bash
docker logs <api-container> --since 30m 2>&1 |
  grep -C 20 '14f4a702-d18f-4225-ac1d-502dfabc2792'
```

R2 upload logs include only the request ID, failure stage, exception type, and
safe category. They omit JWTs, credentials, upload IDs, object keys, and signed
URLs.

If the safe category is `storage_schema_outdated`, apply migration 0028 before
retrying the upload.
