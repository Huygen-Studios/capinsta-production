# Authentication, ownership, and idempotency

Every project route under `/api` and `/api/v1` crosses the Supabase JWT
middleware. Repository queries also scope by `AuthenticatedActor`; foreign
and deleted projects are hidden. Browser RLS permits safe owner reads but no
direct orchestration writes.

All mutations require `Idempotency-Key`, scoped by actor and operation.
Canonical secret-free request JSON is reserved in the mutation transaction.
Same key/request replays the safe response, another request conflicts, and
unfinished work is distinguishable.

Errors use existing normalized machine codes. SQL, stack traces, credentials,
claim tokens, signed URLs, and raw provider failures are not exposed.
