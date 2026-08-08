-- Migration 0029: Durable worker heartbeats and ephemeral Clipper session lifecycle.

CREATE TABLE IF NOT EXISTS "processing_worker_instances" (
  "worker_id" text PRIMARY KEY,
  "build_sha" text NOT NULL DEFAULT 'unknown',
  "role" text NOT NULL,
  "supported_job_types" text[] NOT NULL,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "last_poll_at" timestamptz NOT NULL DEFAULT now(),
  "last_successful_claim_at" timestamptz,
  "active_job_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "processing_worker_instances" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON "processing_worker_instances" TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON "processing_worker_instances" TO service_role;
CREATE POLICY "processing_worker_instances_owner_select" ON "processing_worker_instances"
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT,UPDATE,DELETE ON "processing_worker_instances" FROM authenticated;

CREATE TABLE IF NOT EXISTS "automatic_clipper_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "media_asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE CASCADE,
  "clip_project_id" text REFERENCES "clip_projects"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'active',
  "last_heartbeat_at" timestamptz NOT NULL DEFAULT now(),
  "abandon_requested_at" timestamptz,
  "preserve_until" timestamptz,
  "transferred_at" timestamptz,
  "completed_at" timestamptz,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "automatic_clipper_sessions_status_check" CHECK (
    "status" IN (
      'active','processing','candidate_review','composing',
      'exporting','completed','transferred_to_editor',
      'abandon_requested','deleting','deleted','failed'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "automatic_clipper_sessions_active_media_idx"
  ON "automatic_clipper_sessions" ("media_asset_id")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "automatic_clipper_sessions" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON "automatic_clipper_sessions" TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON "automatic_clipper_sessions" TO service_role;
CREATE POLICY "automatic_clipper_sessions_owner_select" ON "automatic_clipper_sessions"
  FOR SELECT TO authenticated USING ("owner_user_id"=(SELECT auth.uid()));
REVOKE INSERT,UPDATE,DELETE ON "automatic_clipper_sessions" FROM authenticated;
