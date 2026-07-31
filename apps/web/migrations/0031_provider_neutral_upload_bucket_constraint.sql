-- 0031_provider_neutral_upload_bucket_constraint.sql

BEGIN;

ALTER TABLE "public"."media_upload_sessions"
  DROP CONSTRAINT IF EXISTS "media_upload_sessions_storage_pair_check";

ALTER TABLE "public"."media_upload_sessions"
  ADD CONSTRAINT "media_upload_sessions_storage_pair_check" CHECK (
    length("storage_bucket") > 0
    AND length("storage_path") > 0
    AND "storage_path" !~ '^[\\/]'
    AND "storage_path" !~ '\\\\'
    AND "storage_path" !~ '(^|/)\\.\\.(/|$)'
  );

COMMIT;
