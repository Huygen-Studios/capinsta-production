BEGIN;

ALTER TABLE caption_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS immutable_request JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS caption_jobs_user_idempotency_idx
  ON caption_jobs(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
