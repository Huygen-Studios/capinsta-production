-- Stage 2 durable clipping persistence.
-- Drizzle SQL migrations are the repository's authoritative Supabase/Postgres
-- migration stream. Runtime caption/export SQLite tables are intentionally
-- unchanged.

CREATE TABLE "media_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "display_name" text NOT NULL,
  "mime_type" text,
  "media_kind" text NOT NULL DEFAULT 'unknown',
  "source_type" text NOT NULL DEFAULT 'unknown',
  "duration_ms" bigint,
  "width" integer,
  "height" integer,
  "fps_numerator" integer,
  "fps_denominator" integer,
  "size_bytes" bigint,
  "checksum" text,
  "storage_bucket" text,
  "storage_path" text,
  "status" text NOT NULL DEFAULT 'pending',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "revision" bigint NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "media_assets_kind_check" CHECK ("media_kind" IN ('video','audio','image','unknown')),
  CONSTRAINT "media_assets_source_check" CHECK ("source_type" IN ('uploaded','recorded','imported','generated','unknown')),
  CONSTRAINT "media_assets_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0),
  CONSTRAINT "media_assets_size_check" CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0),
  CONSTRAINT "media_assets_width_check" CHECK ("width" IS NULL OR "width" > 0),
  CONSTRAINT "media_assets_height_check" CHECK ("height" IS NULL OR "height" > 0),
  CONSTRAINT "media_assets_fps_check" CHECK (
    ("fps_numerator" IS NULL AND "fps_denominator" IS NULL)
    OR ("fps_numerator" >= 0 AND "fps_denominator" > 0)
  ),
  CONSTRAINT "media_assets_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "media_assets_storage_pair_check" CHECK (
    ("storage_bucket" IS NULL) = ("storage_path" IS NULL)
  ),
  CONSTRAINT "media_assets_portable_storage_check" CHECK (
    "storage_path" IS NULL OR (
      "storage_path" !~ '^[A-Za-z]:[\\/]'
      AND "storage_path" !~ '^/'
      AND "storage_path" !~ '(^|[\\/])\\.\\.([\\/]|$)'
    )
  )
);

CREATE TABLE "media_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "media_asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE CASCADE,
  "variant_type" text NOT NULL,
  "mime_type" text,
  "width" integer,
  "height" integer,
  "duration_ms" bigint,
  "size_bytes" bigint,
  "storage_bucket" text,
  "storage_path" text,
  "status" text NOT NULL DEFAULT 'pending',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "media_variants_type_check" CHECK ("variant_type" IN (
    'proxy','thumbnail','waveform','audio_extract','rendered_clip','captioned_export'
  )),
  CONSTRAINT "media_variants_width_check" CHECK ("width" IS NULL OR "width" > 0),
  CONSTRAINT "media_variants_height_check" CHECK ("height" IS NULL OR "height" > 0),
  CONSTRAINT "media_variants_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0),
  CONSTRAINT "media_variants_size_check" CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0),
  CONSTRAINT "media_variants_storage_pair_check" CHECK (
    ("storage_bucket" IS NULL) = ("storage_path" IS NULL)
  ),
  CONSTRAINT "media_variants_portable_storage_check" CHECK (
    "storage_path" IS NULL OR (
      "storage_path" !~ '^[A-Za-z]:[\\/]'
      AND "storage_path" !~ '^/'
      AND "storage_path" !~ '(^|[\\/])\\.\\.([\\/]|$)'
    )
  )
);

CREATE TABLE "transcripts" (
  "id" text PRIMARY KEY,
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "media_asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE CASCADE,
  "schema_version" integer NOT NULL,
  "provider_name" text,
  "provider_model" text,
  "language_mode" text,
  "duration_ms" bigint NOT NULL,
  "status" text NOT NULL DEFAULT 'ready',
  "revision" bigint NOT NULL DEFAULT 1,
  "document" jsonb NOT NULL,
  "quality" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "transcripts_schema_check" CHECK ("schema_version" = 2),
  CONSTRAINT "transcripts_duration_check" CHECK ("duration_ms" >= 0),
  CONSTRAINT "transcripts_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "transcripts_document_schema_check" CHECK (("document"->>'schemaVersion')::integer = "schema_version"),
  CONSTRAINT "transcripts_document_id_check" CHECK ("document"->>'transcriptId' = "id"),
  CONSTRAINT "transcripts_document_media_check" CHECK ("document"->>'mediaId' = "media_asset_id"::text),
  CONSTRAINT "transcripts_document_duration_check" CHECK (("document"->>'durationMs')::bigint = "duration_ms")
);

CREATE TABLE "clip_projects" (
  "id" text PRIMARY KEY,
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "source_media_asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE RESTRICT,
  "transcript_id" text REFERENCES "transcripts"("id") ON DELETE SET NULL,
  "schema_version" integer NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "project" jsonb NOT NULL,
  "latest_edl" jsonb,
  "latest_remapped_transcript" jsonb,
  "latest_conversion_result" jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz,
  "deleted_at" timestamptz,
  CONSTRAINT "clip_projects_schema_check" CHECK ("schema_version" = 1),
  CONSTRAINT "clip_projects_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "clip_projects_status_check" CHECK ("status" IN (
    'draft','processing','ready','exporting','exported','failed','archived'
  )),
  CONSTRAINT "clip_projects_document_schema_check" CHECK (("project"->>'schemaVersion')::integer = "schema_version"),
  CONSTRAINT "clip_projects_document_id_check" CHECK ("project"->>'clipProjectId' = "id"),
  CONSTRAINT "clip_projects_document_media_check" CHECK ("project"->'sourceMedia'->>'mediaId' = "source_media_asset_id"::text),
  CONSTRAINT "clip_projects_document_revision_check" CHECK (("project"->>'revision')::bigint = "revision")
);

CREATE TABLE "clip_project_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clip_project_id" text NOT NULL REFERENCES "clip_projects"("id") ON DELETE CASCADE,
  "revision" bigint NOT NULL,
  "project" jsonb NOT NULL,
  "created_by" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "change_summary" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "clip_project_versions_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "clip_project_versions_unique_revision" UNIQUE ("clip_project_id","revision")
);

CREATE TABLE "processing_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "project_id" text REFERENCES "clip_projects"("id") ON DELETE SET NULL,
  "media_asset_id" uuid REFERENCES "media_assets"("id") ON DELETE SET NULL,
  "job_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "priority" integer NOT NULL DEFAULT 0,
  "progress" numeric NOT NULL DEFAULT 0,
  "current_stage" text,
  "input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output" jsonb,
  "error" jsonb,
  "idempotency_key" text,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "worker_id" text,
  "heartbeat_at" timestamptz,
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "cancel_requested_at" timestamptz,
  "cancelled_at" timestamptz,
  "revision" bigint NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "processing_jobs_type_check" CHECK ("job_type" IN (
    'media_probe','proxy_generation','audio_extraction','transcription',
    'transcript_analysis','silence_analysis','highlight_analysis','clip_export',
    'caption_export','project_conversion'
  )),
  CONSTRAINT "processing_jobs_status_check" CHECK ("status" IN (
    'queued','claimed','running','succeeded','failed','retry_wait',
    'cancel_requested','cancelled','expired'
  )),
  CONSTRAINT "processing_jobs_progress_check" CHECK ("progress" >= 0 AND "progress" <= 100),
  CONSTRAINT "processing_jobs_success_progress_check" CHECK ("status" <> 'succeeded' OR "progress" = 100),
  CONSTRAINT "processing_jobs_attempt_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "processing_jobs_max_attempts_check" CHECK ("max_attempts" >= 1),
  CONSTRAINT "processing_jobs_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "processing_jobs_owner_idempotency" UNIQUE ("owner_user_id","job_type","idempotency_key")
);

CREATE TABLE "idempotency_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  "scope" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'in_progress',
  "response_code" integer,
  "response" jsonb,
  "resource_type" text,
  "resource_id" text,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "idempotency_records_status_check" CHECK ("status" IN ('in_progress','completed','failed','expired')),
  CONSTRAINT "idempotency_records_scope_key" UNIQUE ("scope","idempotency_key")
);

CREATE INDEX "media_assets_owner_idx" ON "media_assets" ("owner_user_id");
CREATE INDEX "media_assets_status_idx" ON "media_assets" ("status");
CREATE INDEX "media_variants_asset_idx" ON "media_variants" ("media_asset_id");
CREATE INDEX "transcripts_owner_idx" ON "transcripts" ("owner_user_id");
CREATE INDEX "transcripts_media_idx" ON "transcripts" ("media_asset_id");
CREATE INDEX "clip_projects_owner_updated_idx" ON "clip_projects" ("owner_user_id","updated_at" DESC);
CREATE INDEX "clip_projects_media_idx" ON "clip_projects" ("source_media_asset_id");
CREATE INDEX "processing_jobs_owner_created_idx" ON "processing_jobs" ("owner_user_id","created_at" DESC);
CREATE INDEX "processing_jobs_project_idx" ON "processing_jobs" ("project_id");
CREATE INDEX "processing_jobs_status_available_idx" ON "processing_jobs" ("status","available_at");
CREATE INDEX "processing_jobs_type_idx" ON "processing_jobs" ("job_type");
CREATE INDEX "idempotency_records_expiry_idx" ON "idempotency_records" ("expires_at") WHERE "expires_at" IS NOT NULL;

-- Enforce same-owner relationship chains even for trusted server writes.
CREATE OR REPLACE FUNCTION public.capinsta_validate_clipping_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'transcripts' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.media_assets m
      WHERE m.id = NEW.media_asset_id AND m.owner_user_id = NEW.owner_user_id
    ) THEN
      RAISE EXCEPTION 'transcript media owner mismatch' USING ERRCODE = '23503';
    END IF;
  ELSIF TG_TABLE_NAME = 'clip_projects' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.media_assets m
      WHERE m.id = NEW.source_media_asset_id AND m.owner_user_id = NEW.owner_user_id
    ) THEN
      RAISE EXCEPTION 'clip project media owner mismatch' USING ERRCODE = '23503';
    END IF;
    IF NEW.transcript_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.transcripts t
      WHERE t.id = NEW.transcript_id
        AND t.owner_user_id = NEW.owner_user_id
        AND t.media_asset_id = NEW.source_media_asset_id
    ) THEN
      RAISE EXCEPTION 'clip project transcript owner or media mismatch' USING ERRCODE = '23503';
    END IF;
  ELSIF TG_TABLE_NAME = 'processing_jobs' THEN
    IF NEW.project_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.clip_projects p
      WHERE p.id = NEW.project_id AND p.owner_user_id = NEW.owner_user_id
    ) THEN
      RAISE EXCEPTION 'processing job project owner mismatch' USING ERRCODE = '23503';
    END IF;
    IF NEW.media_asset_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.media_assets m
      WHERE m.id = NEW.media_asset_id AND m.owner_user_id = NEW.owner_user_id
    ) THEN
      RAISE EXCEPTION 'processing job media owner mismatch' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "transcripts_validate_owner"
  BEFORE INSERT OR UPDATE ON "transcripts"
  FOR EACH ROW EXECUTE FUNCTION public.capinsta_validate_clipping_ownership();
CREATE TRIGGER "clip_projects_validate_owner"
  BEFORE INSERT OR UPDATE ON "clip_projects"
  FOR EACH ROW EXECUTE FUNCTION public.capinsta_validate_clipping_ownership();
CREATE TRIGGER "processing_jobs_validate_owner"
  BEFORE INSERT OR UPDATE ON "processing_jobs"
  FOR EACH ROW EXECUTE FUNCTION public.capinsta_validate_clipping_ownership();

ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transcripts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clip_projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clip_project_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;

-- Browser access is read-only. Contract validation and server-managed field
-- updates stay behind FastAPI's trusted Postgres connection.
GRANT SELECT ON "media_assets","media_variants","transcripts","clip_projects",
  "clip_project_versions","processing_jobs","idempotency_records" TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON "media_assets","media_variants","transcripts",
  "clip_projects","clip_project_versions","processing_jobs","idempotency_records" TO service_role;

CREATE POLICY "media_assets_owner_select" ON "media_assets"
  FOR SELECT TO authenticated USING ("owner_user_id" = (SELECT auth.uid()));
CREATE POLICY "media_variants_owner_select" ON "media_variants"
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.media_assets m
    WHERE m.id = "media_asset_id" AND m.owner_user_id = (SELECT auth.uid())
  ));
CREATE POLICY "transcripts_owner_select" ON "transcripts"
  FOR SELECT TO authenticated USING ("owner_user_id" = (SELECT auth.uid()));
CREATE POLICY "clip_projects_owner_select" ON "clip_projects"
  FOR SELECT TO authenticated USING ("owner_user_id" = (SELECT auth.uid()));
CREATE POLICY "clip_project_versions_owner_select" ON "clip_project_versions"
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.clip_projects p
    WHERE p.id = "clip_project_id" AND p.owner_user_id = (SELECT auth.uid())
  ));
CREATE POLICY "processing_jobs_owner_select" ON "processing_jobs"
  FOR SELECT TO authenticated USING ("owner_user_id" = (SELECT auth.uid()));
CREATE POLICY "idempotency_records_owner_select" ON "idempotency_records"
  FOR SELECT TO authenticated USING ("owner_user_id" = (SELECT auth.uid()));
