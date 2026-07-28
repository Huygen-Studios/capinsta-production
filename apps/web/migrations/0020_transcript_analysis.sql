-- Stage 2.7: durable transcript/audio analysis and reviewable recommendations.

CREATE TABLE "transcript_analyses" (
  "id" text PRIMARY KEY,
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "media_asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE CASCADE,
  "transcript_id" text NOT NULL REFERENCES "transcripts"("id") ON DELETE CASCADE,
  "transcript_revision" bigint NOT NULL,
  "media_revision" bigint NOT NULL,
  "audio_variant_id" uuid REFERENCES "media_variants"("id") ON DELETE RESTRICT,
  "audio_variant_revision" bigint,
  "analysis_type" text NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 1,
  "analysis_spec" jsonb NOT NULL,
  "analysis_spec_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "document" jsonb,
  "summary" jsonb,
  "failure" jsonb,
  "result_identity" text,
  "revision" bigint NOT NULL DEFAULT 1,
  "ready_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "transcript_analyses_type_check"
    CHECK ("analysis_type" IN ('silence','transcript_review')),
  CONSTRAINT "transcript_analyses_status_check"
    CHECK ("status" IN ('queued','analyzing','normalizing','ready','failed','deleted')),
  CONSTRAINT "transcript_analyses_schema_check" CHECK ("schema_version"=1),
  CONSTRAINT "transcript_analyses_revision_check" CHECK (
    "transcript_revision">=1 AND "media_revision">=1 AND "revision">=1
    AND ("audio_variant_revision" IS NULL OR "audio_variant_revision">=1)
  ),
  CONSTRAINT "transcript_analyses_hash_check"
    CHECK ("analysis_spec_hash" ~ '^[0-9a-f]{64}$'
      AND ("result_identity" IS NULL OR "result_identity" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "transcript_analyses_audio_identity_check" CHECK (
    ("analysis_type"='silence' AND "audio_variant_id" IS NOT NULL
      AND "audio_variant_revision" IS NOT NULL)
    OR
    ("analysis_type"='transcript_review' AND "audio_variant_id" IS NULL
      AND "audio_variant_revision" IS NULL)
  ),
  CONSTRAINT "transcript_analyses_ready_check" CHECK (
    "status"<>'ready' OR (
      "document" IS NOT NULL AND "summary" IS NOT NULL
      AND "result_identity" IS NOT NULL AND "ready_at" IS NOT NULL
      AND "failure" IS NULL
    )
  )
);

CREATE UNIQUE INDEX "transcript_analyses_identity_key"
  ON "transcript_analyses" (
    "transcript_id","transcript_revision","media_revision","analysis_type",
    "analysis_spec_hash",COALESCE("audio_variant_id",'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("audio_variant_revision",0)
  ) WHERE "deleted_at" IS NULL;
CREATE INDEX "transcript_analyses_owner_status_idx"
  ON "transcript_analyses" ("owner_user_id","status","updated_at")
  WHERE "deleted_at" IS NULL;
CREATE INDEX "transcript_analyses_transcript_idx"
  ON "transcript_analyses" ("transcript_id","transcript_revision");

CREATE TABLE "timeline_recommendations" (
  "id" text PRIMARY KEY,
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "analysis_id" text NOT NULL REFERENCES "transcript_analyses"("id") ON DELETE CASCADE,
  "media_asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE CASCADE,
  "transcript_id" text NOT NULL REFERENCES "transcripts"("id") ON DELETE CASCADE,
  "recommendation_type" text NOT NULL,
  "source_start_ms" bigint,
  "source_end_ms" bigint,
  "word_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "segment_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "reason_code" text NOT NULL,
  "severity" text NOT NULL,
  "confidence" numeric,
  "recommendation" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'proposed',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "timeline_recommendations_type_check" CHECK (
    "recommendation_type" IN (
      'remove_silence','review_filler','review_low_confidence','review_timing'
    )
  ),
  CONSTRAINT "timeline_recommendations_status_check"
    CHECK ("status" IN ('proposed','accepted','rejected','superseded')),
  CONSTRAINT "timeline_recommendations_severity_check"
    CHECK ("severity" IN ('info','suggestion','review','warning')),
  CONSTRAINT "timeline_recommendations_time_check" CHECK (
    ("source_start_ms" IS NULL AND "source_end_ms" IS NULL)
    OR ("source_start_ms">=0 AND "source_end_ms">"source_start_ms")
  ),
  CONSTRAINT "timeline_recommendations_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence">=0 AND "confidence"<=1)),
  CONSTRAINT "timeline_recommendations_arrays_check"
    CHECK (jsonb_typeof("word_ids")='array' AND jsonb_typeof("segment_ids")='array')
);
CREATE INDEX "timeline_recommendations_analysis_idx"
  ON "timeline_recommendations" ("analysis_id","status","source_start_ms");
CREATE INDEX "timeline_recommendations_owner_idx"
  ON "timeline_recommendations" ("owner_user_id","created_at");

ALTER TABLE "transcript_analyses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "timeline_recommendations" ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON
  "transcript_analyses","timeline_recommendations" TO service_role;
GRANT SELECT (
  "id","owner_user_id","media_asset_id","transcript_id","transcript_revision",
  "media_revision","audio_variant_id","audio_variant_revision","analysis_type",
  "schema_version","analysis_spec","analysis_spec_hash","status","document",
  "summary","revision","ready_at","created_at","updated_at","deleted_at"
) ON "transcript_analyses" TO authenticated;
GRANT SELECT ON "timeline_recommendations" TO authenticated;

CREATE POLICY "transcript_analyses_owner_select" ON "transcript_analyses"
  FOR SELECT TO authenticated USING (
    "owner_user_id"=(SELECT auth.uid()) AND "deleted_at" IS NULL
  );
CREATE POLICY "timeline_recommendations_owner_select" ON "timeline_recommendations"
  FOR SELECT TO authenticated USING (
    "owner_user_id"=(SELECT auth.uid())
  );

CREATE FUNCTION enforce_transcript_analysis_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  transcript_owner uuid;
  transcript_media uuid;
  asset_owner uuid;
BEGIN
  SELECT owner_user_id,media_asset_id INTO transcript_owner,transcript_media
  FROM transcripts WHERE id=NEW.transcript_id;
  SELECT owner_user_id INTO asset_owner FROM media_assets WHERE id=NEW.media_asset_id;
  IF transcript_owner IS DISTINCT FROM NEW.owner_user_id
     OR asset_owner IS DISTINCT FROM NEW.owner_user_id
     OR transcript_media IS DISTINCT FROM NEW.media_asset_id THEN
    RAISE EXCEPTION 'transcript analysis owner/media identity mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "transcript_analyses_identity_trigger"
  BEFORE INSERT OR UPDATE ON "transcript_analyses"
  FOR EACH ROW EXECUTE FUNCTION enforce_transcript_analysis_identity();

CREATE FUNCTION enforce_timeline_recommendation_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  analysis_owner uuid;
  analysis_media uuid;
  analysis_transcript text;
BEGIN
  SELECT owner_user_id,media_asset_id,transcript_id
  INTO analysis_owner,analysis_media,analysis_transcript
  FROM transcript_analyses WHERE id=NEW.analysis_id;
  IF analysis_owner IS DISTINCT FROM NEW.owner_user_id
     OR analysis_media IS DISTINCT FROM NEW.media_asset_id
     OR analysis_transcript IS DISTINCT FROM NEW.transcript_id THEN
    RAISE EXCEPTION 'timeline recommendation analysis identity mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "timeline_recommendations_identity_trigger"
  BEFORE INSERT OR UPDATE ON "timeline_recommendations"
  FOR EACH ROW EXECUTE FUNCTION enforce_timeline_recommendation_identity();
