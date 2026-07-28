# Monitoring

Use existing structured logs, sanitized Sentry events, admin metrics, provider
health, product events, and processing-job tables. Alert on readiness failure,
oldest queued age, failure/retry rate, lease recovery, upload/provider/export
failures, Whop failures, quota denials, and cleanup/deletion failures.

Logs may include stable resource IDs and safe counts. They must never include
transcripts, prompts, provider responses, signed URLs, tokens, secrets, local
paths, webhook bodies, or project JSON.
