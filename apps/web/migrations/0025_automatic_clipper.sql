-- Stage 4: ranked short candidates and revision-bound automatic compositions.

ALTER TABLE "transcript_analyses"
  DROP CONSTRAINT "transcript_analyses_type_check",
  DROP CONSTRAINT "transcript_analyses_audio_identity_check";
ALTER TABLE "transcript_analyses"
  ADD CONSTRAINT "transcript_analyses_type_check"
    CHECK ("analysis_type" IN ('silence','transcript_review','viral_candidates')),
  ADD CONSTRAINT "transcript_analyses_audio_identity_check" CHECK (
    ("analysis_type"='silence' AND "audio_variant_id" IS NOT NULL
      AND "audio_variant_revision" IS NOT NULL)
    OR
    ("analysis_type" IN ('transcript_review','viral_candidates')
      AND "audio_variant_id" IS NULL AND "audio_variant_revision" IS NULL)
  );

CREATE TABLE "clip_candidates" (
  "id" text PRIMARY KEY,
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "clip_project_id" text NOT NULL REFERENCES "clip_projects"("id") ON DELETE CASCADE,
  "analysis_id" text NOT NULL REFERENCES "transcript_analyses"("id") ON DELETE CASCADE,
  "media_asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE CASCADE,
  "media_revision" bigint NOT NULL,
  "transcript_id" text NOT NULL REFERENCES "transcripts"("id") ON DELETE CASCADE,
  "transcript_revision" bigint NOT NULL,
  "project_revision" bigint NOT NULL,
  "candidate" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'proposed',
  "reframe_plan" jsonb,
  "reframe_identity" text,
  "composition" jsonb,
  "composition_identity" text,
  "selected_project_revision" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "clip_candidates_status_check"
    CHECK ("status" IN ('proposed','selected','rejected','superseded')),
  CONSTRAINT "clip_candidates_revision_check" CHECK (
    "media_revision">=1 AND "transcript_revision">=1 AND "project_revision">=1
    AND ("selected_project_revision" IS NULL OR "selected_project_revision">=1)
  ),
  CONSTRAINT "clip_candidates_json_check" CHECK (
    jsonb_typeof("candidate")='object'
    AND ("reframe_plan" IS NULL OR jsonb_typeof("reframe_plan")='object')
    AND ("composition" IS NULL OR jsonb_typeof("composition")='object')
  ),
  CONSTRAINT "clip_candidates_identity_check" CHECK (
    ("reframe_identity" IS NULL OR "reframe_identity" ~ '^[0-9a-f]{64}$')
    AND ("composition_identity" IS NULL OR "composition_identity" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "clip_candidates_selection_check" CHECK (
    ("status"='selected' AND "composition" IS NOT NULL
      AND "composition_identity" IS NOT NULL AND "selected_project_revision" IS NOT NULL)
    OR ("status"<>'selected')
  ),
  CONSTRAINT "clip_candidates_analysis_key" UNIQUE ("analysis_id","id")
);

CREATE INDEX "clip_candidates_project_status_idx"
  ON "clip_candidates" ("clip_project_id","status","created_at","id");
CREATE INDEX "clip_candidates_analysis_idx"
  ON "clip_candidates" ("analysis_id","created_at","id");

CREATE FUNCTION enforce_clip_candidate_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  project_owner uuid;
  project_media uuid;
  project_transcript text;
  analysis_owner uuid;
  analysis_media uuid;
  analysis_transcript text;
BEGIN
  SELECT owner_user_id,source_media_asset_id,transcript_id
  INTO project_owner,project_media,project_transcript
  FROM clip_projects WHERE id=NEW.clip_project_id;
  SELECT owner_user_id,media_asset_id,transcript_id
  INTO analysis_owner,analysis_media,analysis_transcript
  FROM transcript_analyses WHERE id=NEW.analysis_id;
  IF project_owner IS DISTINCT FROM NEW.owner_user_id
     OR analysis_owner IS DISTINCT FROM NEW.owner_user_id
     OR project_media IS DISTINCT FROM NEW.media_asset_id
     OR analysis_media IS DISTINCT FROM NEW.media_asset_id
     OR project_transcript IS DISTINCT FROM NEW.transcript_id
     OR analysis_transcript IS DISTINCT FROM NEW.transcript_id THEN
    RAISE EXCEPTION 'clip candidate lineage mismatch' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "clip_candidates_identity_trigger"
  BEFORE INSERT OR UPDATE ON "clip_candidates"
  FOR EACH ROW EXECUTE FUNCTION enforce_clip_candidate_identity();

ALTER TABLE "clip_candidates" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON "clip_candidates" TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON "clip_candidates" TO service_role;
CREATE POLICY "clip_candidates_owner_select" ON "clip_candidates"
  FOR SELECT TO authenticated USING ("owner_user_id"=(SELECT auth.uid()));
REVOKE INSERT,UPDATE,DELETE ON "clip_candidates" FROM authenticated;

ALTER TABLE "processing_jobs" DROP CONSTRAINT "processing_jobs_type_check";
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_type_check"
  CHECK ("job_type" IN (
    'media_probe','proxy_generation','audio_extraction','thumbnail_generation',
    'waveform_generation','transcription','transcript_analysis',
    'silence_analysis','highlight_analysis','viral_candidate_analysis',
    'smart_reframe','clip_export','caption_export',
    'project_derivation','project_conversion'
  ));
