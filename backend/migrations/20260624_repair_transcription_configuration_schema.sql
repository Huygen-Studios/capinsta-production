BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS transcription_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  pipeline_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  timestamp_strategy TEXT NOT NULL,
  strict_provider BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  test_status TEXT NOT NULL DEFAULT 'untested',
  tested_at TIMESTAMPTZ,
  tested_by UUID,
  test_error_code TEXT,
  test_latency_ms INTEGER,
  activated_at TIMESTAMPTZ,
  activated_by UUID,
  activation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transcription_configurations
  ADD COLUMN IF NOT EXISTS provider_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pipeline_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS strict_provider BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS test_status TEXT NOT NULL DEFAULT 'untested',
  ADD COLUMN IF NOT EXISTS tested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tested_by UUID,
  ADD COLUMN IF NOT EXISTS test_error_code TEXT,
  ADD COLUMN IF NOT EXISTS test_latency_ms INTEGER,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_by UUID,
  ADD COLUMN IF NOT EXISTS activation_reason TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS transcription_configuration_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_id UUID NOT NULL REFERENCES transcription_configurations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_snapshot JSONB,
  after_snapshot JSONB NOT NULL,
  reason TEXT NOT NULL,
  changed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcription_configurations_status_idx
  ON transcription_configurations(status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS transcription_configurations_one_active_idx
  ON transcription_configurations(status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS transcription_configuration_versions_config_idx
  ON transcription_configuration_versions(configuration_id, version, created_at);

COMMIT;
