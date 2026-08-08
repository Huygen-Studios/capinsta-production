-- Private Server is sales-assisted. This table stores validated server-side inquiries only.

CREATE TABLE IF NOT EXISTS "private_server_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "status" text NOT NULL DEFAULT 'new',
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "company_name" text NOT NULL,
  "phone" text,
  "website" text,
  "team_size" text,
  "monthly_workload" text NOT NULL,
  "primary_use_case" text NOT NULL,
  "current_plan_or_usage" text,
  "preferred_contact_method" text,
  "preferred_contact_time" text,
  "technical_requirements" text,
  "message" text NOT NULL,
  "consent_to_contact" boolean NOT NULL,
  "submitted_from_url" text,
  "user_id" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "ip_hash" text,
  "user_agent" text,
  "internal_notes" text,
  "contacted_at" timestamptz,
  "closed_at" timestamptz,
  CONSTRAINT "private_server_requests_status_check"
    CHECK ("status" IN ('new','reviewing','contacted','qualified','declined','closed')),
  CONSTRAINT "private_server_requests_consent_check"
    CHECK ("consent_to_contact" = true),
  CONSTRAINT "private_server_requests_email_check"
    CHECK (char_length("email") BETWEEN 3 AND 320 AND position('@' in "email") > 1),
  CONSTRAINT "private_server_requests_required_lengths_check"
    CHECK (
      char_length(btrim("full_name")) BETWEEN 1 AND 160
      AND char_length(btrim("company_name")) BETWEEN 1 AND 180
      AND char_length(btrim("monthly_workload")) BETWEEN 1 AND 80
      AND char_length(btrim("primary_use_case")) BETWEEN 1 AND 120
      AND char_length(btrim("message")) BETWEEN 1 AND 2000
    )
);

CREATE INDEX IF NOT EXISTS "private_server_requests_status_created_idx"
  ON "private_server_requests" ("status", "created_at");

CREATE INDEX IF NOT EXISTS "private_server_requests_email_created_idx"
  ON "private_server_requests" ("email", "created_at");

CREATE INDEX IF NOT EXISTS "private_server_requests_user_created_idx"
  ON "private_server_requests" ("user_id", "created_at");

ALTER TABLE "private_server_requests" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "private_server_requests" FROM anon;
REVOKE ALL ON "private_server_requests" FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON "private_server_requests" TO service_role;

DROP POLICY IF EXISTS "private_server_requests_admin_select" ON "private_server_requests";
CREATE POLICY "private_server_requests_admin_select"
ON "private_server_requests" FOR SELECT TO authenticated
USING (public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "private_server_requests_admin_update" ON "private_server_requests";
CREATE POLICY "private_server_requests_admin_update"
ON "private_server_requests" FOR UPDATE TO authenticated
USING (public.capinsta_has_admin_role(NULL))
WITH CHECK (public.capinsta_has_admin_role(NULL));
