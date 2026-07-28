-- Stage 3.3: revision-bound durable clipping exports.

CREATE TABLE "clipping_exports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "clip_project_id" text NOT NULL REFERENCES "clip_projects"("id") ON DELETE RESTRICT,
  "clip_project_revision" bigint NOT NULL,
  "edl_result_identity" text NOT NULL,
  "remapped_transcript_result_identity" text NOT NULL,
  "conversion_result_identity" text NOT NULL,
  "export_spec" jsonb NOT NULL,
  "export_spec_hash" text NOT NULL,
  "request_identity" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "processing_job_id" uuid NOT NULL UNIQUE REFERENCES "processing_jobs"("id") ON DELETE RESTRICT,
  "storage_bucket" text,
  "storage_path" text,
  "mime_type" text,
  "size_bytes" bigint,
  "duration_ms" bigint,
  "width" integer,
  "height" integer,
  "checksum" text,
  "result_identity" text,
  "failure" jsonb,
  "revision" bigint NOT NULL DEFAULT 1,
  "ready_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "clipping_exports_revision_check"
    CHECK ("clip_project_revision">=1 AND "revision">=0),
  CONSTRAINT "clipping_exports_identity_check" CHECK (
    "edl_result_identity" ~ '^[0-9a-f]{64}$'
    AND "remapped_transcript_result_identity" ~ '^[0-9a-f]{64}$'
    AND "conversion_result_identity" ~ '^[0-9a-f]{64}$'
    AND "export_spec_hash" ~ '^[0-9a-f]{64}$'
    AND "request_identity" ~ '^[0-9a-f]{64}$'
    AND ("result_identity" IS NULL OR "result_identity" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "clipping_exports_status_check" CHECK ("status" IN (
    'queued','rendering','verifying','uploading','ready','failed','cancelled','deleted'
  )),
  CONSTRAINT "clipping_exports_output_check" CHECK (
    ("status"='ready' AND "storage_bucket"='media-exports'
      AND "storage_path" IS NOT NULL AND "mime_type"='video/mp4'
      AND "size_bytes">0 AND "duration_ms">=0 AND "width">0 AND "height">0
      AND "checksum" IS NOT NULL AND "result_identity" IS NOT NULL
      AND "ready_at" IS NOT NULL)
    OR
    ("status"<>'ready' AND "ready_at" IS NULL)
  )
);

CREATE UNIQUE INDEX "clipping_exports_active_identity_key"
  ON "clipping_exports" ("request_identity")
  WHERE "status" IN ('queued','rendering','verifying','uploading','ready');
CREATE INDEX "clipping_exports_owner_created_idx"
  ON "clipping_exports" ("owner_user_id","created_at" DESC);
CREATE INDEX "clipping_exports_project_created_idx"
  ON "clipping_exports" ("clip_project_id","created_at" DESC);

CREATE OR REPLACE FUNCTION enforce_clipping_export_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  project_owner uuid;
  job_owner uuid;
  job_project text;
  job_kind text;
BEGIN
  SELECT owner_user_id INTO project_owner FROM clip_projects WHERE id=NEW.clip_project_id;
  SELECT owner_user_id,project_id,job_type INTO job_owner,job_project,job_kind
    FROM processing_jobs WHERE id=NEW.processing_job_id;
  IF project_owner IS DISTINCT FROM NEW.owner_user_id
     OR job_owner IS DISTINCT FROM NEW.owner_user_id
     OR job_project IS DISTINCT FROM NEW.clip_project_id
     OR job_kind IS DISTINCT FROM 'clip_export' THEN
    RAISE EXCEPTION 'clipping export identity mismatch' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "clipping_exports_identity_trigger"
  BEFORE INSERT OR UPDATE ON "clipping_exports"
  FOR EACH ROW EXECUTE FUNCTION enforce_clipping_export_identity();

ALTER TABLE "clipping_exports" ENABLE ROW LEVEL SECURITY;
GRANT SELECT (
  "id","clip_project_id","clip_project_revision","status","processing_job_id",
  "mime_type","size_bytes","duration_ms","width","height","revision","ready_at",
  "created_at","updated_at","deleted_at"
) ON "clipping_exports" TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON "clipping_exports" TO service_role;
CREATE POLICY "clipping_exports_owner_select"
  ON "clipping_exports" FOR SELECT TO authenticated
  USING ("owner_user_id"=(SELECT auth.uid()));
REVOKE INSERT,UPDATE,DELETE ON "clipping_exports" FROM authenticated;
