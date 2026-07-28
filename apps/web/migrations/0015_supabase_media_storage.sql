-- Stage 2.2 private Supabase Storage and durable upload sessions.
-- Existing local/SQLite media routes and the legacy capinsta-media bucket are
-- intentionally unchanged.

CREATE TABLE "media_upload_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "media_asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE CASCADE,
  "storage_bucket" text NOT NULL,
  "storage_path" text NOT NULL,
  "upload_protocol" text NOT NULL,
  "purpose" text NOT NULL DEFAULT 'initial',
  "status" text NOT NULL DEFAULT 'created',
  "expected_size_bytes" bigint NOT NULL,
  "received_size_bytes" bigint NOT NULL DEFAULT 0,
  "display_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "checksum_algorithm" text,
  "expected_checksum" text,
  "provider_upload_id" text,
  "replacement_revision" bigint,
  "previous_storage_bucket" text,
  "previous_storage_path" text,
  "expires_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  "failed_at" timestamptz,
  "error" jsonb,
  "revision" bigint NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "media_upload_sessions_protocol_check" CHECK ("upload_protocol" IN ('tus')),
  CONSTRAINT "media_upload_sessions_purpose_check" CHECK ("purpose" IN ('initial','replacement')),
  CONSTRAINT "media_upload_sessions_status_check" CHECK ("status" IN (
    'created','authorized','uploading','uploaded','verifying','completed',
    'failed','expired','cancelled'
  )),
  CONSTRAINT "media_upload_sessions_size_check" CHECK (
    "expected_size_bytes" > 0
    AND "received_size_bytes" >= 0
    AND "received_size_bytes" <= "expected_size_bytes"
  ),
  CONSTRAINT "media_upload_sessions_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "media_upload_sessions_replacement_check" CHECK (
    ("purpose" = 'initial' AND "replacement_revision" IS NULL)
    OR ("purpose" = 'replacement' AND "replacement_revision" >= 2)
  ),
  CONSTRAINT "media_upload_sessions_storage_pair_check" CHECK (
    "storage_bucket" = 'source-media'
    AND "storage_path" !~ '^[\\/]'
    AND "storage_path" !~ '\\\\'
    AND "storage_path" !~ '(^|/)\\.\\.(/|$)'
  ),
  CONSTRAINT "media_upload_sessions_unique_object" UNIQUE ("storage_bucket","storage_path")
);

CREATE INDEX "media_upload_sessions_owner_created_idx"
  ON "media_upload_sessions" ("owner_user_id","created_at" DESC);
CREATE INDEX "media_upload_sessions_asset_idx"
  ON "media_upload_sessions" ("media_asset_id","created_at" DESC);
CREATE INDEX "media_upload_sessions_expiry_idx"
  ON "media_upload_sessions" ("expires_at")
  WHERE "status" NOT IN ('completed','failed','expired','cancelled');

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

CREATE TRIGGER "media_upload_sessions_validate"
  BEFORE INSERT OR UPDATE ON "media_upload_sessions"
  FOR EACH ROW EXECUTE FUNCTION public.capinsta_validate_media_upload_session();

ALTER TABLE "media_upload_sessions" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON "media_upload_sessions" TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON "media_upload_sessions" TO service_role;
CREATE POLICY "media_upload_sessions_owner_select" ON "media_upload_sessions"
  FOR SELECT TO authenticated
  USING ("owner_user_id" = (SELECT auth.uid()));

-- Bucket provisioning is conditional so plain PostgreSQL development remains
-- possible. On Supabase, refuse to silently repurpose a public bucket.
DO $$
DECLARE bucket_name text;
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL
     AND to_regclass('storage.objects') IS NOT NULL THEN
    FOREACH bucket_name IN ARRAY ARRAY['source-media','media-variants','media-exports'] LOOP
      IF EXISTS (
        SELECT 1 FROM storage.buckets b
        WHERE b.id = bucket_name AND b.public = true
      ) THEN
        RAISE EXCEPTION 'Refusing to reuse public storage bucket %', bucket_name;
      END IF;
    END LOOP;

    INSERT INTO storage.buckets
      (id,name,public,file_size_limit,allowed_mime_types)
    VALUES (
      'source-media','source-media',false,2147483648,
      ARRAY[
        'video/mp4','video/quicktime','video/webm',
        'audio/mpeg','audio/wav','audio/x-wav','audio/mp4',
        'audio/webm','audio/ogg'
      ]::text[]
    )
    ON CONFLICT (id) DO UPDATE SET
      public=false,
      file_size_limit=EXCLUDED.file_size_limit,
      allowed_mime_types=EXCLUDED.allowed_mime_types;

    INSERT INTO storage.buckets (id,name,public)
    VALUES
      ('media-variants','media-variants',false),
      ('media-exports','media-exports',false)
    ON CONFLICT (id) DO UPDATE SET public=false;

    EXECUTE 'DROP POLICY IF EXISTS "source_media_owner_select" ON storage.objects';
    EXECUTE 'CREATE POLICY "source_media_owner_select"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = ''source-media''
        AND split_part(name,''/'',1) = (SELECT auth.uid())::text
        AND EXISTS (
          SELECT 1 FROM public.media_assets m
          WHERE m.id::text = split_part(name,''/'',2)
            AND m.owner_user_id = (SELECT auth.uid())
            AND m.deleted_at IS NULL
        )
      )';

    EXECUTE 'DROP POLICY IF EXISTS "source_media_authorized_insert" ON storage.objects';
    EXECUTE 'CREATE POLICY "source_media_authorized_insert"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = ''source-media''
        AND split_part(name,''/'',1) = (SELECT auth.uid())::text
        AND EXISTS (
          SELECT 1 FROM public.media_upload_sessions s
          WHERE s.owner_user_id = (SELECT auth.uid())
            AND s.storage_bucket = bucket_id
            AND s.storage_path = name
            AND s.status IN (''created'',''authorized'',''uploading'')
            AND s.expires_at > now()
        )
      )';
  END IF;
END $$;
