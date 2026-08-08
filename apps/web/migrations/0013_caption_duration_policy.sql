ALTER TABLE "user_quotas"
  ALTER COLUMN "max_upload_duration_seconds" SET DEFAULT 180;

UPDATE "user_quotas"
SET "max_upload_duration_seconds" = 180
WHERE "max_upload_duration_seconds" > 180;

UPDATE "system_settings"
SET "value" = '180',
    "updated_at" = now()
WHERE "key" = 'maximum_upload_duration_seconds'
  AND "value" <> '180';
