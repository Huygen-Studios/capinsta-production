-- Stage 2.8: authenticated project orchestration, decisions, and provenance.

ALTER TABLE "clip_projects"
  ADD COLUMN "media_revision" bigint,
  ADD COLUMN "transcript_revision" bigint,
  ADD COLUMN "latest_edl_revision" bigint,
  ADD COLUMN "latest_remapped_transcript_revision" bigint,
  ADD COLUMN "latest_conversion_revision" bigint,
  ADD CONSTRAINT "clip_projects_dependency_revision_check" CHECK (
    ("media_revision" IS NULL OR "media_revision">=1)
    AND ("transcript_revision" IS NULL OR "transcript_revision">=1)
  ),
  ADD CONSTRAINT "clip_projects_derived_revision_check" CHECK (
    ("latest_edl_revision" IS NULL OR "latest_edl_revision">=1)
    AND ("latest_remapped_transcript_revision" IS NULL OR "latest_remapped_transcript_revision">=1)
    AND ("latest_conversion_revision" IS NULL OR "latest_conversion_revision">=1)
  );

ALTER TABLE "clip_project_versions"
  ADD COLUMN "version_source" text NOT NULL DEFAULT 'manual',
  ADD COLUMN "transcript_revision" bigint,
  ADD COLUMN "derivation_identity" text,
  ADD CONSTRAINT "clip_project_versions_source_check" CHECK (
    "version_source" IN ('manual','accepted_recommendations','system_import','archive','delete')
  ),
  ADD CONSTRAINT "clip_project_versions_transcript_revision_check"
    CHECK ("transcript_revision" IS NULL OR "transcript_revision">=1),
  ADD CONSTRAINT "clip_project_versions_derivation_identity_check"
    CHECK ("derivation_identity" IS NULL OR "derivation_identity" ~ '^[0-9a-f]{64}$');

ALTER TABLE "timeline_recommendations"
  ADD COLUMN "decided_by" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN "decided_at" timestamptz,
  ADD COLUMN "decision_note" text,
  ADD COLUMN "decision_request_id" text,
  ADD COLUMN "decision_project_revision" bigint,
  ADD CONSTRAINT "timeline_recommendations_decision_check" CHECK (
    ("status"='proposed' AND "decided_by" IS NULL AND "decided_at" IS NULL)
    OR
    ("status" IN ('accepted','rejected') AND "decided_by" IS NOT NULL
      AND "decided_at" IS NOT NULL AND "decision_project_revision">=1)
    OR "status"='superseded'
  ),
  ADD CONSTRAINT "timeline_recommendations_decision_note_check"
    CHECK ("decision_note" IS NULL OR length("decision_note")<=500),
  ADD CONSTRAINT "timeline_recommendations_decision_request_check"
    CHECK ("decision_request_id" IS NULL OR length("decision_request_id")<=200);

CREATE TABLE "clip_project_recommendation_consumptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "clip_project_id" text NOT NULL REFERENCES "clip_projects"("id") ON DELETE CASCADE,
  "project_revision" bigint NOT NULL,
  "recommendation_id" text NOT NULL REFERENCES "timeline_recommendations"("id") ON DELETE RESTRICT,
  "derivation_identity" text NOT NULL,
  "created_by" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "clip_project_recommendation_consumptions_revision_check"
    CHECK ("project_revision">=1),
  CONSTRAINT "clip_project_recommendation_consumptions_identity_check"
    CHECK ("derivation_identity" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "clip_project_recommendation_consumptions_unique"
    UNIQUE ("clip_project_id","project_revision","recommendation_id")
);
CREATE INDEX "clip_project_consumptions_owner_idx"
  ON "clip_project_recommendation_consumptions" ("owner_user_id","created_at");
CREATE INDEX "clip_project_consumptions_derivation_idx"
  ON "clip_project_recommendation_consumptions"
  ("clip_project_id","derivation_identity");

ALTER TABLE "processing_jobs"
  DROP CONSTRAINT "processing_jobs_type_check";
ALTER TABLE "processing_jobs"
  ADD CONSTRAINT "processing_jobs_type_check" CHECK ("job_type" IN (
    'media_probe','proxy_generation','audio_extraction','thumbnail_generation',
    'waveform_generation','transcription','transcript_analysis',
    'silence_analysis','highlight_analysis','clip_export','caption_export',
    'project_derivation','project_conversion'
  ));

CREATE OR REPLACE FUNCTION enforce_clip_project_consumption_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  project_owner uuid;
  project_transcript text;
  recommendation_owner uuid;
  recommendation_transcript text;
BEGIN
  SELECT owner_user_id,transcript_id INTO project_owner,project_transcript
    FROM clip_projects WHERE id=NEW.clip_project_id;
  SELECT owner_user_id,transcript_id INTO recommendation_owner,recommendation_transcript
    FROM timeline_recommendations WHERE id=NEW.recommendation_id;
  IF project_owner IS DISTINCT FROM NEW.owner_user_id
     OR recommendation_owner IS DISTINCT FROM NEW.owner_user_id
     OR project_transcript IS DISTINCT FROM recommendation_transcript THEN
    RAISE EXCEPTION 'project recommendation consumption identity mismatch'
      USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "clip_project_consumptions_identity_trigger"
  BEFORE INSERT OR UPDATE ON "clip_project_recommendation_consumptions"
  FOR EACH ROW EXECUTE FUNCTION enforce_clip_project_consumption_identity();

ALTER TABLE "clip_project_recommendation_consumptions" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON "clip_project_recommendation_consumptions" TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON
  "clip_project_recommendation_consumptions" TO service_role;
CREATE POLICY "clip_project_consumptions_owner_select"
  ON "clip_project_recommendation_consumptions"
  FOR SELECT TO authenticated USING ("owner_user_id"=(SELECT auth.uid()));

-- Keep browser roles read-only after the new columns and table are added.
REVOKE INSERT,UPDATE,DELETE ON "clip_projects","clip_project_versions",
  "timeline_recommendations","clip_project_recommendation_consumptions"
  FROM authenticated;
