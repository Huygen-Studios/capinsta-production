-- Canonical product entitlement records for admin-managed product access.
-- The application server writes these through privileged Drizzle connections;
-- authenticated users may only read their own rows through the Data API.

CREATE TABLE IF NOT EXISTS "app_product_entitlements" (
  "user_id" uuid NOT NULL,
  "product_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'granted',
  "granted_by" uuid,
  "granted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_by" uuid,
  "revoked_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "reason" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "app_product_entitlements_pk" PRIMARY KEY ("user_id","product_id"),
  CONSTRAINT "app_product_entitlements_status_check"
    CHECK ("status" IN ('granted','revoked'))
);

CREATE INDEX IF NOT EXISTS "app_product_entitlements_user_status_idx"
  ON "app_product_entitlements" ("user_id","status");
CREATE INDEX IF NOT EXISTS "app_product_entitlements_product_status_idx"
  ON "app_product_entitlements" ("product_id","status");
CREATE INDEX IF NOT EXISTS "app_product_entitlements_expires_idx"
  ON "app_product_entitlements" ("expires_at");

CREATE TABLE IF NOT EXISTS "app_product_access_bulk_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "idempotency_key" text NOT NULL UNIQUE,
  "actor_user_id" uuid NOT NULL,
  "action" text NOT NULL,
  "product_ids" jsonb NOT NULL,
  "requested_user_ids" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'completed',
  "reason" text NOT NULL,
  "outcome" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "app_product_access_bulk_actor_created_idx"
  ON "app_product_access_bulk_operations" ("actor_user_id","created_at");
CREATE INDEX IF NOT EXISTS "app_product_access_bulk_status_created_idx"
  ON "app_product_access_bulk_operations" ("status","created_at");

GRANT SELECT ON "app_product_entitlements" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "app_product_entitlements" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON "app_product_access_bulk_operations" TO service_role;

ALTER TABLE "app_product_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_product_access_bulk_operations" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_product_entitlements_read_own_or_admin" ON "app_product_entitlements";
CREATE POLICY "app_product_entitlements_read_own_or_admin"
ON "app_product_entitlements" FOR SELECT TO authenticated
USING ("user_id" = auth.uid() OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "app_product_access_bulk_admin_read" ON "app_product_access_bulk_operations";
CREATE POLICY "app_product_access_bulk_admin_read"
ON "app_product_access_bulk_operations" FOR SELECT TO authenticated
USING (public.capinsta_has_admin_role(NULL));
