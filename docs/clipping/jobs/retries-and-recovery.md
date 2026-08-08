# Retries and crash recovery

Retry delay is:

```text
min(base × multiplier^(attempt - 1), maximum)
```

Optional bounded symmetric jitter is applied afterward. Defaults are 10
seconds, multiplier 2, maximum 900 seconds, and 20 percent jitter. Disabling
jitter makes calculation deterministic.

A retryable failure with attempts remaining becomes `retry_wait`; its
`next_retry_at` and `available_at` are persisted. A non-retryable or exhausted
failure becomes terminal `failed`. Retry promotion is a durable
`retry_wait → queued` update and explicitly resets progress to zero for the new
attempt. No in-memory timer controls eligibility.

The recovery sweep uses a namespaced transaction-level PostgreSQL advisory
lock and bounded `FOR UPDATE SKIP LOCKED` batches. Failure to acquire leadership
is an ordinary no-op. Expired claimed/running jobs become retry-wait or failed
according to attempts. Expired cancel-requested jobs become cancelled. Attempt
history records lease expiry, prior worker, and structured safe failure.

Workers may invoke the lightweight sweep at a controlled interval; the
advisory lock prevents simultaneous global mutation. It is also exposed as a
callable service for a future dedicated Coolify scheduled process.

