BEGIN;

ALTER TABLE transcription_configurations
  ADD COLUMN IF NOT EXISTS preset_id TEXT,
  ADD COLUMN IF NOT EXISTS preset_version INTEGER,
  ADD COLUMN IF NOT EXISTS pipeline_option_sources JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transcription_configurations_preset_version_positive'
  ) THEN
    ALTER TABLE transcription_configurations
      ADD CONSTRAINT transcription_configurations_preset_version_positive
      CHECK (preset_version IS NULL OR preset_version >= 1) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS transcription_configurations_preset_idx
  ON transcription_configurations(preset_id, preset_version)
  WHERE preset_id IS NOT NULL;

COMMIT;
