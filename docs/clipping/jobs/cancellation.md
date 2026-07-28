# Durable job cancellation

Cancellation is durable and idempotent:

- `queued` or `retry_wait` becomes `cancelled` immediately.
- `claimed` or `running` becomes `cancel_requested` while retaining its active
  lease.
- terminal states remain unchanged.

The worker observes active cancellation through heartbeats and the
`JobExecutionContext` cancellation callback. A cooperative handler stops and
the owning claim acknowledges `cancelled`. An expired cancel-requested lease is
also finalized by recovery.

Cancelled jobs clear retry timestamps and cannot be claimed, retried, or
completed successfully. Cancellation reasons are bounded safe text. Task 2.3
does not add generic subprocess termination; future processor handlers must
provide their own safe cooperative termination hooks.

