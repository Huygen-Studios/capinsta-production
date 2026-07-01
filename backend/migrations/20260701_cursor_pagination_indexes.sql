BEGIN;

CREATE INDEX IF NOT EXISTS caption_jobs_user_created_id_idx
  ON caption_jobs(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS export_jobs_user_created_id_idx
  ON export_jobs(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS media_assets_user_created_id_idx
  ON media_assets(user_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

COMMIT;
