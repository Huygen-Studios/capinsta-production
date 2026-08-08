-- SQLite production ownership migration.
-- Existing rows remain unowned and are intentionally inaccessible through authenticated APIs.
ALTER TABLE jobs ADD COLUMN user_id TEXT;
ALTER TABLE export_jobs ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_user_id_created_at
ON jobs (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_export_jobs_user_id_created_at
ON export_jobs (user_id, created_at);
