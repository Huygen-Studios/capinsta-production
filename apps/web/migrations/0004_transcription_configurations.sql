CREATE TABLE IF NOT EXISTS transcription_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('gemini','openai','sarvam')),
  model text NOT NULL,
  provider_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  timestamp_strategy text NOT NULL CHECK (timestamp_strategy IN ('provider_word','structured_word_validate','local_forced_alignment')),
  strict_provider boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive','failed_test')),
  version integer NOT NULL DEFAULT 1,
  test_status text NOT NULL DEFAULT 'untested' CHECK (test_status IN ('untested','passed','failed')),
  tested_at timestamptz,
  tested_by uuid,
  test_error_code text,
  test_latency_ms integer,
  activated_at timestamptz,
  activated_by uuid,
  activation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS transcription_configurations_one_active_idx
  ON transcription_configurations ((true))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS transcription_configurations_status_idx
  ON transcription_configurations (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS transcription_configuration_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_id uuid NOT NULL REFERENCES transcription_configurations(id) ON DELETE CASCADE,
  version integer NOT NULL,
  action text NOT NULL CHECK (action IN ('create_draft','test','activate','deactivate')),
  before_snapshot jsonb,
  after_snapshot jsonb NOT NULL,
  reason text NOT NULL,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcription_configuration_versions_config_idx
  ON transcription_configuration_versions (configuration_id, version DESC, created_at DESC);

ALTER TABLE caption_jobs
  ADD COLUMN IF NOT EXISTS transcription_model text,
  ADD COLUMN IF NOT EXISTS transcription_config_version integer,
  ADD COLUMN IF NOT EXISTS timestamp_strategy text,
  ADD COLUMN IF NOT EXISTS provider_mode text,
  ADD COLUMN IF NOT EXISTS timing_source_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO admin_permissions (key, description)
VALUES
  ('system.manage_providers', 'Create, test, activate, and deactivate transcription provider configurations.')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE transcription_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcription_configuration_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON transcription_configurations FROM anon, authenticated;
REVOKE ALL ON transcription_configuration_versions FROM anon, authenticated;
