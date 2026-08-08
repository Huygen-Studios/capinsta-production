-- Add provider-neutral Storage references and R2 multipart upload metadata.
-- Existing Supabase Storage objects remain in place and default to provider=supabase.

ALTER TABLE "media_assets"
  ADD COLUMN IF NOT EXISTS "storage_provider" text NOT NULL DEFAULT 'supabase',
  ADD COLUMN IF NOT EXISTS "storage_etag" text,
  ADD COLUMN IF NOT EXISTS "storage_sha256" text;

ALTER TABLE "media_variants"
  ADD COLUMN IF NOT EXISTS "storage_provider" text NOT NULL DEFAULT 'supabase',
  ADD COLUMN IF NOT EXISTS "storage_etag" text,
  ADD COLUMN IF NOT EXISTS "storage_sha256" text;

ALTER TABLE "clipping_exports"
  ADD COLUMN IF NOT EXISTS "storage_provider" text NOT NULL DEFAULT 'supabase',
  ADD COLUMN IF NOT EXISTS "storage_etag" text,
  ADD COLUMN IF NOT EXISTS "storage_sha256" text;

ALTER TABLE "media_upload_sessions"
  ADD COLUMN IF NOT EXISTS "storage_provider" text NOT NULL DEFAULT 'supabase',
  ADD COLUMN IF NOT EXISTS "previous_storage_provider" text,
  ADD COLUMN IF NOT EXISTS "multipart_upload_id" text,
  ADD COLUMN IF NOT EXISTS "multipart_part_size_bytes" bigint,
  ADD COLUMN IF NOT EXISTS "multipart_part_count" integer,
  ADD COLUMN IF NOT EXISTS "multipart_state" text,
  ADD COLUMN IF NOT EXISTS "signed_url_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "aborted_at" timestamptz;

ALTER TABLE "media_assets"
  DROP CONSTRAINT IF EXISTS "media_assets_storage_provider_check";
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_storage_provider_check"
  CHECK ("storage_provider" IN ('supabase','r2','local'));

ALTER TABLE "media_variants"
  DROP CONSTRAINT IF EXISTS "media_variants_storage_provider_check";
ALTER TABLE "media_variants"
  ADD CONSTRAINT "media_variants_storage_provider_check"
  CHECK ("storage_provider" IN ('supabase','r2','local'));

ALTER TABLE "clipping_exports"
  DROP CONSTRAINT IF EXISTS "clipping_exports_storage_provider_check";
ALTER TABLE "clipping_exports"
  ADD CONSTRAINT "clipping_exports_storage_provider_check"
  CHECK ("storage_provider" IN ('supabase','r2','local'));

ALTER TABLE "media_upload_sessions"
  DROP CONSTRAINT IF EXISTS "media_upload_sessions_storage_provider_check";
ALTER TABLE "media_upload_sessions"
  ADD CONSTRAINT "media_upload_sessions_storage_provider_check"
  CHECK ("storage_provider" IN ('supabase','r2','local'));

ALTER TABLE "media_upload_sessions"
  DROP CONSTRAINT IF EXISTS "media_upload_sessions_protocol_check";
ALTER TABLE "media_upload_sessions"
  ADD CONSTRAINT "media_upload_sessions_protocol_check"
  CHECK ("upload_protocol" IN ('tus','s3_multipart'));

ALTER TABLE "media_upload_sessions"
  DROP CONSTRAINT IF EXISTS "media_upload_sessions_multipart_check";
ALTER TABLE "media_upload_sessions"
  ADD CONSTRAINT "media_upload_sessions_multipart_check" CHECK (
    ("upload_protocol" = 'tus'
      AND "multipart_upload_id" IS NULL
      AND "multipart_part_size_bytes" IS NULL
      AND "multipart_part_count" IS NULL
      AND "multipart_state" IS NULL)
    OR
    ("upload_protocol" = 's3_multipart'
      AND "storage_provider" = 'r2'
      AND ("multipart_upload_id" IS NULL OR length("multipart_upload_id") <= 2048)
      AND ("multipart_part_size_bytes" IS NULL OR "multipart_part_size_bytes" >= 5242880)
      AND ("multipart_part_count" IS NULL OR "multipart_part_count" BETWEEN 1 AND 10000)
      AND ("multipart_state" IS NULL OR "multipart_state" IN ('created','completed','aborted')))
  );

CREATE INDEX IF NOT EXISTS "media_upload_sessions_active_multipart_idx"
  ON "media_upload_sessions" ("storage_provider","status","expires_at")
  WHERE "upload_protocol" = 's3_multipart'
    AND "status" NOT IN ('completed','failed','expired','cancelled');

CREATE OR REPLACE FUNCTION public.capinsta_validate_media_upload_session()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.media_assets m
    WHERE m.id = NEW.media_asset_id AND m.owner_user_id = NEW.owner_user_id
  ) THEN
    RAISE EXCEPTION 'upload session media owner mismatch' USING ERRCODE = '23503';
  END IF;
  IF split_part(NEW.storage_path,'/',1) <> NEW.owner_user_id::text
     OR split_part(NEW.storage_path,'/',2) <> NEW.media_asset_id::text
     OR split_part(NEW.storage_path,'/',3) <> 'source'
     OR split_part(NEW.storage_path,'/',4) = '' THEN
    RAISE EXCEPTION 'upload session storage path mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.owner_user_id <> OLD.owner_user_id
    OR NEW.media_asset_id <> OLD.media_asset_id
    OR NEW.storage_provider <> OLD.storage_provider
    OR NEW.storage_bucket <> OLD.storage_bucket
    OR NEW.storage_path <> OLD.storage_path
    OR NEW.upload_protocol <> OLD.upload_protocol
    OR NEW.purpose <> OLD.purpose
    OR NEW.expected_size_bytes <> OLD.expected_size_bytes
    OR NEW.display_name <> OLD.display_name
    OR NEW.mime_type <> OLD.mime_type
  ) THEN
    RAISE EXCEPTION 'authorized upload identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('completed','failed','expired','cancelled')
     AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'terminal upload session cannot transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
