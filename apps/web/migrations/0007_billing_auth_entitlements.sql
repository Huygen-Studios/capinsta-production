-- Billing, donation, and Auth-profile hardening.
-- Idempotent for production repair: auth.users remains the identity source of truth.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "plan_entitlements" (
  "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "entitlement_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "source" text NOT NULL DEFAULT 'system',
  "subscription_id" uuid,
  "starts_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plan_entitlements_pk" PRIMARY KEY ("user_id","entitlement_key"),
  CONSTRAINT "plan_entitlements_status_check" CHECK ("status" IN ('active','inactive','expired','cancelled')),
  CONSTRAINT "plan_entitlements_key_check" CHECK ("entitlement_key" IN ('free','private_server','no_ads','private_worker'))
);

CREATE INDEX IF NOT EXISTS "plan_entitlements_user_status_idx"
  ON "plan_entitlements" ("user_id","status");
CREATE INDEX IF NOT EXISTS "plan_entitlements_key_status_idx"
  ON "plan_entitlements" ("entitlement_key","status");

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "provider" text NOT NULL DEFAULT 'razorpay',
  "provider_subscription_id" text NOT NULL UNIQUE,
  "provider_plan_id" text,
  "plan_key" text NOT NULL,
  "status" text NOT NULL,
  "amount_inr" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'INR',
  "current_period_start" timestamptz,
  "current_period_end" timestamptz,
  "cancelled_at" timestamptz,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "subscriptions_plan_key_check" CHECK ("plan_key" IN ('private_server')),
  CONSTRAINT "subscriptions_status_check" CHECK ("status" IN ('created','authenticated','active','pending','halted','cancelled','completed','expired','failed'))
);

CREATE INDEX IF NOT EXISTS "subscriptions_user_status_idx"
  ON "subscriptions" ("user_id","status","updated_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plan_entitlements_subscription_fk'
  ) THEN
    ALTER TABLE "plan_entitlements"
      ADD CONSTRAINT "plan_entitlements_subscription_fk"
      FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "payment_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" text NOT NULL DEFAULT 'razorpay',
  "provider_event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "signature_valid" boolean NOT NULL DEFAULT false,
  "processed_at" timestamptz,
  "processing_status" text NOT NULL DEFAULT 'received',
  "processing_error" text,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payment_events_provider_event_unique" UNIQUE ("provider","provider_event_id")
);

CREATE INDEX IF NOT EXISTS "payment_events_type_created_idx"
  ON "payment_events" ("event_type","created_at");

CREATE TABLE IF NOT EXISTS "donations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "provider" text NOT NULL DEFAULT 'razorpay',
  "provider_order_id" text UNIQUE,
  "provider_payment_id" text UNIQUE,
  "amount_inr" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'INR',
  "status" text NOT NULL DEFAULT 'created',
  "donor_name" text,
  "donor_message" text,
  "anonymous" boolean NOT NULL DEFAULT false,
  "receipt_email" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "verified_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "donations_amount_check" CHECK ("amount_inr" IN (100,250,500,1000,2500,5000,10000,25000,50000)),
  CONSTRAINT "donations_status_check" CHECK ("status" IN ('created','paid','failed','refunded'))
);

CREATE INDEX IF NOT EXISTS "donations_user_created_idx"
  ON "donations" ("user_id","created_at");
CREATE INDEX IF NOT EXISTS "donations_status_created_idx"
  ON "donations" ("status","created_at");

CREATE TABLE IF NOT EXISTS "dedicated_worker_provisioning_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "subscription_id" uuid REFERENCES "subscriptions"("id") ON DELETE SET NULL,
  "state" text NOT NULL DEFAULT 'pending',
  "adapter" text NOT NULL DEFAULT 'manual',
  "worker_assignment" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "activated_at" timestamptz,
  "cancelled_at" timestamptz,
  CONSTRAINT "dedicated_worker_state_check" CHECK ("state" IN ('pending','provisioning','active','failed','deprovisioning','cancelled'))
);

CREATE INDEX IF NOT EXISTS "dedicated_worker_user_state_idx"
  ON "dedicated_worker_provisioning_jobs" ("user_id","state","updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "dedicated_worker_one_open_job_idx"
  ON "dedicated_worker_provisioning_jobs" ("user_id")
  WHERE "state" IN ('pending','provisioning','active');

CREATE TABLE IF NOT EXISTS "profile_auth_orphans" (
  "user_id" uuid PRIMARY KEY,
  "email_snapshot" text,
  "detected_at" timestamptz NOT NULL DEFAULT now(),
  "reason" text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_user_auth_fk'
  ) THEN
    ALTER TABLE "profiles"
      ADD CONSTRAINT "profiles_user_auth_fk"
      FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.capinsta_sync_auth_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE provider_name text;
BEGIN
  SELECT provider INTO provider_name
  FROM auth.identities
  WHERE user_id = NEW.id
  ORDER BY created_at ASC
  LIMIT 1;

  INSERT INTO public.profiles (
    user_id, email_snapshot, display_name, product_access_status,
    account_status, auth_provider_snapshot, email_confirmed_at,
    last_sign_in_at, created_at, updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    'approved',
    'active',
    coalesce(provider_name, NEW.raw_app_meta_data->>'provider', 'email'),
    NEW.email_confirmed_at,
    NEW.last_sign_in_at,
    coalesce(NEW.created_at, now()),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email_snapshot = EXCLUDED.email_snapshot,
    display_name = coalesce(public.profiles.display_name, EXCLUDED.display_name),
    auth_provider_snapshot = coalesce(EXCLUDED.auth_provider_snapshot, public.profiles.auth_provider_snapshot),
    email_confirmed_at = EXCLUDED.email_confirmed_at,
    last_sign_in_at = EXCLUDED.last_sign_in_at,
    updated_at = now();

  INSERT INTO public.plan_entitlements (
    user_id, entitlement_key, status, source, starts_at, metadata, created_at, updated_at
  )
  VALUES (
    NEW.id, 'free', 'active', 'auth_signup', now(), '{}'::jsonb, now(), now()
  )
  ON CONFLICT (user_id, entitlement_key) DO UPDATE SET
    status = 'active',
    updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capinsta_sync_auth_profile() FROM PUBLIC;

DROP TRIGGER IF EXISTS "capinsta_auth_user_profile" ON auth.users;
CREATE TRIGGER "capinsta_auth_user_profile"
  AFTER INSERT OR UPDATE OF email, email_confirmed_at, last_sign_in_at, raw_user_meta_data, raw_app_meta_data
  ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.capinsta_sync_auth_profile();

INSERT INTO public.profiles (
  user_id, email_snapshot, display_name, product_access_status, account_status,
  auth_provider_snapshot, email_confirmed_at, last_sign_in_at, created_at, updated_at
)
SELECT
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
  coalesce(p.product_access_status, 'approved'),
  coalesce(p.account_status, 'active'),
  coalesce(i.provider, u.raw_app_meta_data->>'provider', 'email'),
  u.email_confirmed_at,
  u.last_sign_in_at,
  coalesce(u.created_at, now()),
  now()
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
LEFT JOIN LATERAL (
  SELECT provider FROM auth.identities WHERE user_id = u.id ORDER BY created_at ASC LIMIT 1
) i ON true
ON CONFLICT (user_id) DO UPDATE SET
  email_snapshot = EXCLUDED.email_snapshot,
  auth_provider_snapshot = coalesce(EXCLUDED.auth_provider_snapshot, public.profiles.auth_provider_snapshot),
  email_confirmed_at = EXCLUDED.email_confirmed_at,
  last_sign_in_at = EXCLUDED.last_sign_in_at,
  updated_at = now();

INSERT INTO public.plan_entitlements (user_id, entitlement_key, status, source, starts_at, metadata, created_at, updated_at)
SELECT u.id, 'free', 'active', 'backfill', now(), '{}'::jsonb, now(), now()
FROM auth.users u
ON CONFLICT (user_id, entitlement_key) DO UPDATE SET
  status = 'active',
  updated_at = now();

INSERT INTO public.profile_auth_orphans (user_id, email_snapshot, reason)
SELECT p.user_id, p.email_snapshot, 'profile_without_auth_user'
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.user_id
WHERE u.id IS NULL
ON CONFLICT (user_id) DO UPDATE SET
  email_snapshot = EXCLUDED.email_snapshot,
  detected_at = now(),
  reason = EXCLUDED.reason;

GRANT SELECT ON "profiles" TO authenticated;
GRANT SELECT ON "plan_entitlements" TO authenticated;
GRANT SELECT ON "subscriptions" TO authenticated;
GRANT SELECT ON "donations" TO authenticated;
GRANT SELECT ON "dedicated_worker_provisioning_jobs" TO authenticated;
GRANT SELECT ON "profile_auth_orphans" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "plan_entitlements" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscriptions" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_events" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON "donations" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON "dedicated_worker_provisioning_jobs" TO service_role;
GRANT SELECT ON "profile_auth_orphans" TO service_role;

ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "donations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dedicated_worker_provisioning_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile_auth_orphans" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON "profiles";
CREATE POLICY "profiles_select_own_or_admin"
ON "profiles" FOR SELECT TO authenticated
USING ("user_id" = (select auth.uid()) OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "plan_entitlements_select_own_or_admin" ON "plan_entitlements";
CREATE POLICY "plan_entitlements_select_own_or_admin"
ON "plan_entitlements" FOR SELECT TO authenticated
USING ("user_id" = (select auth.uid()) OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "subscriptions_select_own_or_admin" ON "subscriptions";
CREATE POLICY "subscriptions_select_own_or_admin"
ON "subscriptions" FOR SELECT TO authenticated
USING ("user_id" = (select auth.uid()) OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "donations_select_own_or_admin" ON "donations";
CREATE POLICY "donations_select_own_or_admin"
ON "donations" FOR SELECT TO authenticated
USING ("user_id" = (select auth.uid()) OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "worker_jobs_select_own_or_admin" ON "dedicated_worker_provisioning_jobs";
CREATE POLICY "worker_jobs_select_own_or_admin"
ON "dedicated_worker_provisioning_jobs" FOR SELECT TO authenticated
USING ("user_id" = (select auth.uid()) OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "profile_auth_orphans_select_admin" ON "profile_auth_orphans";
CREATE POLICY "profile_auth_orphans_select_admin"
ON "profile_auth_orphans" FOR SELECT TO authenticated
USING (public.capinsta_has_admin_role(NULL));
