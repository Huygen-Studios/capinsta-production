-- Stage 2.6: revision-bound durable transcription identities and lifecycle.

ALTER TABLE "transcripts"
  ADD COLUMN "media_revision" bigint,
  ADD COLUMN "storage_object_revision" bigint,
  ADD COLUMN "audio_variant_id" uuid REFERENCES "media_variants"("id") ON DELETE RESTRICT,
  ADD COLUMN "audio_variant_revision" bigint,
  ADD COLUMN "request_identity" text,
  ADD COLUMN "result_identity" text,
  ADD COLUMN "failure" jsonb,
  ADD COLUMN "ready_at" timestamptz,
  ADD COLUMN "deleted_at" timestamptz;

ALTER TABLE "transcripts"
  ADD CONSTRAINT "transcripts_media_revision_check"
    CHECK ("media_revision" IS NULL OR "media_revision" >= 1),
  ADD CONSTRAINT "transcripts_storage_revision_check"
    CHECK ("storage_object_revision" IS NULL OR "storage_object_revision" >= 1),
  ADD CONSTRAINT "transcripts_audio_variant_revision_check"
    CHECK ("audio_variant_revision" IS NULL OR "audio_variant_revision" >= 1),
  ADD CONSTRAINT "transcripts_request_identity_check"
    CHECK (
      "request_identity" IS NULL
      OR "request_identity" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "transcripts_result_identity_check"
    CHECK (
      "result_identity" IS NULL
      OR "result_identity" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "transcripts_source_identity_check" CHECK (
    (
      "request_identity" IS NULL
      AND "media_revision" IS NULL
      AND "storage_object_revision" IS NULL
      AND "audio_variant_id" IS NULL
      AND "audio_variant_revision" IS NULL
    )
    OR (
      "request_identity" IS NOT NULL
      AND "media_revision" IS NOT NULL
      AND "storage_object_revision" IS NOT NULL
      AND "audio_variant_id" IS NOT NULL
      AND "audio_variant_revision" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "transcripts_status_check" CHECK ("status" IN (
    'queued','transcribing','normalizing','ready','failed','deleted'
  )) NOT VALID,
  ADD CONSTRAINT "transcripts_ready_identity_check" CHECK (
    "status" <> 'ready'
    OR "request_identity" IS NULL
    OR (
      "result_identity" IS NOT NULL
      AND "ready_at" IS NOT NULL
      AND "failure" IS NULL
    )
  );

ALTER TABLE "transcripts"
  VALIDATE CONSTRAINT "transcripts_status_check";

UPDATE "transcripts"
SET "ready_at"=COALESCE("ready_at","updated_at")
WHERE "status"='ready';

CREATE UNIQUE INDEX "transcripts_request_identity_key"
  ON "transcripts" ("owner_user_id","request_identity")
  WHERE "request_identity" IS NOT NULL AND "deleted_at" IS NULL;

CREATE INDEX "transcripts_media_status_idx"
  ON "transcripts" ("media_asset_id","status","updated_at")
  WHERE "deleted_at" IS NULL;

-- Authenticated users keep safe owner-scoped reads but cannot select worker
-- failure or result-identity fields and retain no transcript write grant.
REVOKE SELECT ON "transcripts" FROM authenticated;
GRANT SELECT (
  "id","owner_user_id","media_asset_id","schema_version","provider_name",
  "provider_model","language_mode","duration_ms","status","revision",
  "document","quality","metadata","media_revision",
  "storage_object_revision","audio_variant_id","audio_variant_revision",
  "request_identity","ready_at","created_at","updated_at","deleted_at"
) ON "transcripts" TO authenticated;
