BEGIN;

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS validation_status TEXT,
  ADD COLUMN IF NOT EXISTS validation_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS media_duration_seconds DOUBLE PRECISION;

COMMIT;

-- Down migration, if needed:
-- BEGIN;
-- ALTER TABLE media_assets
--   DROP COLUMN IF EXISTS media_duration_seconds,
--   DROP COLUMN IF EXISTS validation_checked_at,
--   DROP COLUMN IF EXISTS validation_metadata_json,
--   DROP COLUMN IF EXISTS validation_status;
-- COMMIT;
