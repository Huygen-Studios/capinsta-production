# Durable idempotency

An idempotency record is unique by `(scope,idempotency_key)`. User-owned scopes
must include the immutable Supabase user ID, for example
`{user_id}:transcription`; this avoids collisions while preserving the
requested database uniqueness rule.

`begin` atomically reserves a key as `in_progress`. Reusing it with a different
request hash raises `idempotency_conflict`. A non-expired in-progress request
raises `idempotency_in_progress`; a completed request replays its durable
resource/response. Expired records may be reserved again with their prior
result cleared. Failed and explicitly expired records remain auditable.

`ProcessingJobRepository.create_idempotent` reserves the record, creates the
job, and links/completes the record in one Postgres transaction. Either all
three changes commit or none do. Request hashes must be computed from a stable,
secret-free canonical request representation; authorization headers and
tokens must never be stored.

Project orchestration scopes use
`{user_id}:clipping:{operation[:project_id]}`. Create, update, lifecycle,
decisions, accepted-recommendation drafts, derivation, and conversion reserve
and complete records in the authoritative mutation transaction. Replay
responses contain no signed URLs.
