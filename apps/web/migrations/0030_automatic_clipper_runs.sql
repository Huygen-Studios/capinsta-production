-- Migration 0030: Independent Automatic Clipper runs decoupled from media_asset_id.

CREATE TABLE IF NOT EXISTS "automatic_clipper_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL,
  "media_asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE CASCADE,
  "transcript_id" text,
  "clip_project_id" text,
  "status" text NOT NULL DEFAULT 'active',
  "candidate_generation" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "last_heartbeat_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "transferred_at" timestamptz,
  "cancelled_at" timestamptz,
  "deleted_at" timestamptz,
  "preserve_until" timestamptz,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE "automatic_clipper_runs" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON "automatic_clipper_runs" TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON "automatic_clipper_runs" TO service_role;

CREATE POLICY "automatic_clipper_runs_owner_select" ON "automatic_clipper_runs"
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);

REVOKE INSERT,UPDATE,DELETE ON "automatic_clipper_runs" FROM authenticated;

CREATE INDEX IF NOT EXISTS "automatic_clipper_runs_owner_media_idx"
  ON "automatic_clipper_runs" ("owner_user_id", "media_asset_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "automatic_clipper_runs_active_sweep_idx"
  ON "automatic_clipper_runs" ("status", "last_heartbeat_at");
