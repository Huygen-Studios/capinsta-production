-- Stage 2.4 durable media probing.
-- Probe execution remains opt-in at the worker. This migration only makes the
-- authoritative asset revision and readiness lifecycle explicit.

ALTER TABLE "media_assets"
  ADD COLUMN "storage_object_revision" bigint,
  ADD COLUMN "probe_result_identity" text;

-- Stage 2.2 object names end in /v<revision>.<extension>. Prefer that stable
-- object version and use the historical asset revision only as a conservative
-- fallback for pre-2.2 rows.
UPDATE "media_assets"
SET "storage_object_revision" = COALESCE(
  NULLIF(substring("storage_path" FROM '/v([0-9]+)\.[^/]+$'), '')::bigint,
  GREATEST("revision" - 1, 1)
)
WHERE "storage_path" IS NOT NULL
  AND "storage_object_revision" IS NULL;

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_storage_revision_check" CHECK (
    ("storage_path" IS NULL AND "storage_object_revision" IS NULL)
    OR ("storage_path" IS NOT NULL AND "storage_object_revision" >= 1)
  ),
  ADD CONSTRAINT "media_assets_probe_result_identity_check" CHECK (
    "probe_result_identity" IS NULL
    OR "probe_result_identity" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "media_assets_status_check" CHECK (
    "status" IN (
      'pending','pending_upload','failed','ready_for_probe','probing','ready',
      'probe_failed','deletion_pending','deletion_failed','deleted'
    )
  ) NOT VALID;

ALTER TABLE "media_assets"
  VALIDATE CONSTRAINT "media_assets_status_check";

CREATE INDEX "media_assets_probe_queue_idx"
  ON "media_assets" ("status","storage_object_revision","updated_at")
  WHERE "deleted_at" IS NULL
    AND "status" IN ('ready_for_probe','probing');

-- Upgrade still-eligible Stage 2.2 media_probe payloads from authoritative
-- rows. Signed URLs and paths are deliberately not copied into job input.
UPDATE "processing_jobs" AS j
SET "input" = jsonb_set(
    jsonb_set(
      jsonb_set(
        j."input",
        '{expectedMediaRevision}',
        to_jsonb(m."revision"),
        true
      ),
      '{storageObjectRevision}',
      to_jsonb(m."storage_object_revision"),
      true
    ),
    '{requestedFields}',
    'null'::jsonb,
    true
  ),
  "updated_at" = now()
FROM "media_assets" AS m
WHERE j."job_type" = 'media_probe'
  AND j."media_asset_id" = m."id"
  AND j."status" IN ('queued','retry_wait')
  AND m."storage_object_revision" IS NOT NULL
  AND (
    NOT j."input" ? 'expectedMediaRevision'
    OR NOT j."input" ? 'storageObjectRevision'
  );

-- Browser roles remain read-only for authoritative probe fields. Keep this
-- explicit even if an installation previously broadened table grants.
REVOKE INSERT,UPDATE,DELETE ON "media_assets" FROM authenticated;
GRANT SELECT ON "media_assets" TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON "media_assets" TO service_role;
