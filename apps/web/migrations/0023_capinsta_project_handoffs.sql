-- Stage 3.2: authenticated, revision-bound Capinsta project handoffs.

CREATE TABLE "project_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "clip_project_id" text NOT NULL REFERENCES "clip_projects"("id") ON DELETE RESTRICT,
  "clip_project_revision" bigint NOT NULL,
  "conversion_result_identity" text NOT NULL,
  "target_project_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'prepared',
  "manifest_schema_version" integer NOT NULL,
  "manifest" jsonb NOT NULL,
  "request_identity" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "claimed_at" timestamptz,
  "claimed_by" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "imported_project_id" text,
  "imported_project_revision" bigint,
  "completed_at" timestamptz,
  "failure" jsonb,
  "revision" bigint NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_handoffs_revision_check"
    CHECK ("clip_project_revision">=1 AND "revision">=1),
  CONSTRAINT "project_handoffs_identity_check"
    CHECK (
      "conversion_result_identity" ~ '^[0-9a-f]{64}$'
      AND "request_identity" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "project_handoffs_schema_check"
    CHECK ("manifest_schema_version"=1 AND ("manifest"->>'schemaVersion')::integer=1),
  CONSTRAINT "project_handoffs_manifest_identity_check" CHECK (
    "manifest"->>'handoffId'="id"::text
    AND "manifest"->>'clipProjectId'="clip_project_id"
    AND ("manifest"->>'clipProjectRevision')::bigint="clip_project_revision"
    AND "manifest"->>'conversionResultIdentity'="conversion_result_identity"
    AND "manifest"->>'targetProjectId'="target_project_id"
    AND ("manifest"->>'projectSchemaVersion')::integer=35
  ),
  CONSTRAINT "project_handoffs_status_check"
    CHECK ("status" IN ('prepared','claimed','imported','expired','cancelled','failed')),
  CONSTRAINT "project_handoffs_claim_check" CHECK (
    ("status"='prepared' AND "claimed_at" IS NULL AND "claimed_by" IS NULL)
    OR
    ("status" IN ('claimed','imported') AND "claimed_at" IS NOT NULL AND "claimed_by" IS NOT NULL)
    OR "status" IN ('expired','cancelled','failed')
  ),
  CONSTRAINT "project_handoffs_completion_check" CHECK (
    ("status"='imported' AND "imported_project_id"="target_project_id"
      AND "imported_project_revision">=1 AND "completed_at" IS NOT NULL)
    OR
    ("status"<>'imported' AND "imported_project_id" IS NULL
      AND "imported_project_revision" IS NULL AND "completed_at" IS NULL)
  ),
  CONSTRAINT "project_handoffs_expiry_check" CHECK ("expires_at">"created_at"),
  CONSTRAINT "project_handoffs_target_check"
    CHECK (length("target_project_id") BETWEEN 1 AND 200)
);

CREATE INDEX "project_handoffs_owner_created_idx"
  ON "project_handoffs" ("owner_user_id","created_at" DESC);
CREATE INDEX "project_handoffs_project_revision_idx"
  ON "project_handoffs" ("clip_project_id","clip_project_revision");
CREATE INDEX "project_handoffs_expiry_idx"
  ON "project_handoffs" ("status","expires_at");
CREATE UNIQUE INDEX "project_handoffs_active_identity_key"
  ON "project_handoffs" ("request_identity")
  WHERE "status" IN ('prepared','claimed','imported');

CREATE OR REPLACE FUNCTION enforce_project_handoff_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  project_owner uuid;
BEGIN
  SELECT owner_user_id INTO project_owner
    FROM clip_projects WHERE id=NEW.clip_project_id;
  IF project_owner IS DISTINCT FROM NEW.owner_user_id
     OR (NEW.claimed_by IS NOT NULL AND NEW.claimed_by IS DISTINCT FROM NEW.owner_user_id) THEN
    RAISE EXCEPTION 'project handoff identity mismatch' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "project_handoffs_identity_trigger"
  BEFORE INSERT OR UPDATE ON "project_handoffs"
  FOR EACH ROW EXECUTE FUNCTION enforce_project_handoff_identity();

ALTER TABLE "project_handoffs" ENABLE ROW LEVEL SECURITY;
GRANT SELECT (
  "id","clip_project_id","clip_project_revision","target_project_id","status",
  "expires_at","claimed_at","imported_project_id","imported_project_revision",
  "completed_at","revision","created_at","updated_at"
) ON "project_handoffs" TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON "project_handoffs" TO service_role;
CREATE POLICY "project_handoffs_owner_select"
  ON "project_handoffs" FOR SELECT TO authenticated
  USING ("owner_user_id"=(SELECT auth.uid()));

REVOKE INSERT,UPDATE,DELETE ON "project_handoffs" FROM authenticated;
