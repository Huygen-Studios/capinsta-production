# Atomic job claiming

Eligible rows are `queued`, available according to the PostgreSQL clock,
below `max_attempts`, lease-free, and supported by the worker registry.
One transaction performs:

```sql
select ... for update skip locked
update ... returning *
insert processing_job_attempts ...
```

Ordering is priority descending, then `available_at`, `created_at`, and stable
job ID ascending. Concurrent workers skip an already locked candidate instead
of blocking or executing it twice.

Claiming generates a server-side UUID4 claim token, records worker identity,
sets the lease and timestamps, increments `attempt_count` and `revision`, and
creates the append-oriented attempt row. Starting the handler changes
`claimed` to `running` without incrementing the attempt again.

The claim token is unique per attempt and is never returned through browser
APIs or logged. Worker identity without the token is insufficient authority.

