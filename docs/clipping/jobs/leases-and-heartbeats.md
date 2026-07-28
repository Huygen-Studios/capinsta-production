# Leases and heartbeats

Active `claimed`, `running`, and `cancel_requested` jobs require a worker ID,
claim token, and `lease_expires_at`. Every worker mutation verifies all three
against the PostgreSQL clock. An expired or mismatched lease produces a
machine-readable lease error and cannot be revived.

Default lease duration is 90 seconds and heartbeat interval is 30 seconds.
Configuration rejects an interval greater than or equal to the lease.
Heartbeats extend from the current database time, update `heartbeat_at`, may
set coarse stage/progress, increment revision, and never increment attempts.
Progress is bounded to 0–100 and monotonic within an attempt.

Success, failure, retry, and cancellation clear active lease fields. A stale
handler cannot complete after recovery creates a new claim token. `started_at`
records the first-ever execution start; `last_attempt_started_at` records the
current claim.

