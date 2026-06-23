CREATE TABLE "deleted_project_records" (
  "project_id" text PRIMARY KEY,
  "owner_id" uuid,
  "project_created_at" timestamptz,
  "deleted_at" timestamptz NOT NULL DEFAULT now(),
  "source_duration_seconds" numeric,
  "source_size_bytes" bigint,
  "caption_language" text,
  "caption_word_count" integer NOT NULL DEFAULT 0,
  "caption_chunk_count" integer NOT NULL DEFAULT 0,
  "caption_model" text,
  "generation_status" text,
  "generation_processing_seconds" numeric,
  "export_attempt_count" integer NOT NULL DEFAULT 0,
  "export_format" text,
  "export_width" integer,
  "export_height" integer,
  "export_fps" integer,
  "export_duration_seconds" numeric,
  "export_output_size_bytes" bigint,
  "export_processing_seconds" numeric,
  "export_status" text,
  "normalized_error_code" text,
  "deletion_status" text NOT NULL DEFAULT 'completed'
);
CREATE INDEX "deleted_project_records_owner_deleted_idx"
  ON "deleted_project_records" ("owner_id", "deleted_at");
CREATE INDEX "deleted_project_records_deleted_idx"
  ON "deleted_project_records" ("deleted_at");

ALTER TABLE "deleted_project_records" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "deleted_project_records" FROM anon;
REVOKE ALL ON TABLE "deleted_project_records" FROM authenticated;

CREATE OR REPLACE FUNCTION private.prevent_deleted_project_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'deleted project records are immutable';
END;
$$;

CREATE TRIGGER "deleted_project_records_immutable"
BEFORE UPDATE OR DELETE ON "deleted_project_records"
FOR EACH ROW EXECUTE FUNCTION private.prevent_deleted_project_record_mutation();
