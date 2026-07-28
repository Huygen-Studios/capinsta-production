-- Stage 2.5: durable media-variant generation identities and worker lifecycle.

ALTER TABLE "media_variants"
  ADD COLUMN "source_media_revision" bigint,
  ADD COLUMN "source_storage_object_revision" bigint,
  ADD COLUMN "generation_spec" jsonb,
  ADD COLUMN "generation_spec_hash" text,
  ADD COLUMN "result_identity" text,
  ADD COLUMN "failure" jsonb,
  ADD COLUMN "revision" bigint NOT NULL DEFAULT 1,
  ADD COLUMN "ready_at" timestamptz,
  ADD COLUMN "deleted_at" timestamptz;

ALTER TABLE "media_variants"
  ADD CONSTRAINT "media_variants_source_revision_check"
    CHECK ("source_media_revision" IS NULL OR "source_media_revision" >= 1),
  ADD CONSTRAINT "media_variants_storage_revision_check"
    CHECK (
      "source_storage_object_revision" IS NULL
      OR "source_storage_object_revision" >= 1
    ),
  ADD CONSTRAINT "media_variants_spec_hash_check"
    CHECK (
      "generation_spec_hash" IS NULL
      OR "generation_spec_hash" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "media_variants_result_identity_check"
    CHECK (
      "result_identity" IS NULL
      OR "result_identity" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "media_variants_revision_check" CHECK ("revision" >= 1),
  ADD CONSTRAINT "media_variants_status_check" CHECK ("status" IN (
    'pending','queued','processing','uploading','verifying','ready','failed',
    'deletion_pending','deleted'
  )) NOT VALID,
  ADD CONSTRAINT "media_variants_generation_identity_check" CHECK (
    (
      "source_media_revision" IS NULL
      AND "source_storage_object_revision" IS NULL
      AND "generation_spec" IS NULL
      AND "generation_spec_hash" IS NULL
    )
    OR (
      "source_media_revision" IS NOT NULL
      AND "source_storage_object_revision" IS NOT NULL
      AND "generation_spec" IS NOT NULL
      AND "generation_spec_hash" IS NOT NULL
      AND ("generation_spec"->>'schemaVersion')::integer = 1
    )
  ),
  ADD CONSTRAINT "media_variants_ready_fields_check" CHECK (
    "status" <> 'ready'
    OR "source_media_revision" IS NULL
    OR (
      "storage_bucket" IS NOT NULL
      AND "storage_path" IS NOT NULL
      AND "mime_type" IS NOT NULL
      AND "size_bytes" IS NOT NULL
      AND "result_identity" IS NOT NULL
      AND "ready_at" IS NOT NULL
    )
  );

ALTER TABLE "media_variants"
  VALIDATE CONSTRAINT "media_variants_status_check";

CREATE UNIQUE INDEX "media_variants_generation_identity_key"
  ON "media_variants" (
    "media_asset_id","variant_type","source_media_revision",
    "generation_spec_hash"
  )
  WHERE "deleted_at" IS NULL
    AND "source_media_revision" IS NOT NULL
    AND "generation_spec_hash" IS NOT NULL;

CREATE INDEX "media_variants_status_updated_idx"
  ON "media_variants" ("status","updated_at")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "processing_jobs"
  DROP CONSTRAINT "processing_jobs_type_check";
ALTER TABLE "processing_jobs"
  ADD CONSTRAINT "processing_jobs_type_check" CHECK ("job_type" IN (
    'media_probe','proxy_generation','audio_extraction',
    'thumbnail_generation','waveform_generation','transcription',
    'transcript_analysis','silence_analysis','highlight_analysis','clip_export',
    'caption_export','project_conversion'
  ));

-- Browser clients retain owner-scoped safe reads but cannot select authoritative
-- worker failure/identity fields or mutate variant rows.
REVOKE SELECT ON "media_variants" FROM authenticated;
GRANT SELECT (
  "id","media_asset_id","variant_type","mime_type","width","height",
  "duration_ms","size_bytes","storage_bucket","storage_path","status",
  "metadata","source_media_revision","source_storage_object_revision",
  "generation_spec","generation_spec_hash","revision","ready_at","created_at",
  "updated_at","deleted_at"
) ON "media_variants" TO authenticated;

-- A private generated object is readable only through its owning media asset.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "media_variants_owner_select" ON storage.objects';
    EXECUTE 'CREATE POLICY "media_variants_owner_select"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = ''media-variants''
        AND split_part(name,''/'',1) = (SELECT auth.uid())::text
        AND EXISTS (
          SELECT 1 FROM public.media_assets m
          WHERE m.id::text = split_part(name,''/'',2)
            AND m.owner_user_id = (SELECT auth.uid())
            AND m.deleted_at IS NULL
        )
      )';
  END IF;
END $$;
