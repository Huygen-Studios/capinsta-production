CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "product_access_status" text,
  ADD COLUMN IF NOT EXISTS "product_access_approved_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "product_access_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "product_access_updated_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "product_access_updated_by" uuid,
  ADD COLUMN IF NOT EXISTS "product_access_reason" text,
  ADD COLUMN IF NOT EXISTS "auth_provider_snapshot" text,
  ADD COLUMN IF NOT EXISTS "email_confirmed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_sign_in_at" timestamptz;

UPDATE "profiles"
SET
  "product_access_status" = CASE
    WHEN "account_status" = 'active' THEN 'approved'
    ELSE 'revoked'
  END,
  "product_access_approved_at" = CASE
    WHEN "account_status" = 'active' THEN COALESCE("product_access_approved_at", "created_at", now())
    ELSE "product_access_approved_at"
  END,
  "product_access_updated_at" = COALESCE("product_access_updated_at", now()),
  "product_access_reason" = COALESCE("product_access_reason", 'Safe launch-access backfill')
WHERE "product_access_status" IS NULL;

ALTER TABLE "profiles"
  ALTER COLUMN "product_access_status" SET DEFAULT 'pending',
  ALTER COLUMN "product_access_status" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_product_access_status_check'
  ) THEN
    ALTER TABLE "profiles"
      ADD CONSTRAINT "profiles_product_access_status_check"
      CHECK ("product_access_status" IN ('pending','approved','revoked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "profiles_product_access_created_idx"
  ON "profiles" ("product_access_status","created_at");
CREATE INDEX IF NOT EXISTS "profiles_product_access_expires_idx"
  ON "profiles" ("product_access_expires_at");
DROP INDEX IF EXISTS "profiles_email_idx";
CREATE INDEX IF NOT EXISTS "profiles_email_idx" ON "profiles" (lower("email_snapshot"));

CREATE TABLE IF NOT EXISTS "site_access_policy" (
  "id" text PRIMARY KEY DEFAULT 'global',
  "mode" text NOT NULL DEFAULT 'public' CHECK ("mode" IN ('coming_soon','maintenance','public')),
  "allow_signups" boolean NOT NULL DEFAULT true,
  "coming_soon_message" text NOT NULL DEFAULT 'Create your Capinsta account to join the private beta. We''re inviting creators and editors in small groups while we improve timing, editing and export reliability.',
  "maintenance_message" text NOT NULL DEFAULT 'We''re making improvements to the application. Your account and projects remain safe.',
  "version" integer NOT NULL DEFAULT 1,
  "updated_by" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "site_access_policy_global_id_check" CHECK ("id" = 'global')
);

INSERT INTO "site_access_policy" ("id","mode","allow_signups")
VALUES ('global','public',true)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "app_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "app_permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL UNIQUE,
  "description" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "app_role_permissions" (
  "role_id" uuid NOT NULL REFERENCES "app_roles"("id") ON DELETE CASCADE,
  "permission_id" uuid NOT NULL REFERENCES "app_permissions"("id") ON DELETE CASCADE,
  PRIMARY KEY ("role_id","permission_id")
);

CREATE TABLE IF NOT EXISTS "app_role_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "role_id" uuid NOT NULL REFERENCES "app_roles"("id"),
  "active" boolean NOT NULL DEFAULT true,
  "assigned_by" uuid,
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_by" uuid,
  "revoked_at" timestamptz,
  "reason" text NOT NULL CHECK (length(trim("reason")) >= 3),
  "expires_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "app_role_members_user_active_idx" ON "app_role_members" ("user_id","active");
CREATE INDEX IF NOT EXISTS "app_role_members_expires_idx" ON "app_role_members" ("expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "app_role_members_active_role_idx"
  ON "app_role_members" ("user_id","role_id") WHERE "active" = true;

CREATE TABLE IF NOT EXISTS "app_user_permission_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "permission_id" uuid NOT NULL REFERENCES "app_permissions"("id"),
  "effect" text NOT NULL CHECK ("effect" IN ('allow','deny')),
  "active" boolean NOT NULL DEFAULT true,
  "assigned_by" uuid,
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_by" uuid,
  "revoked_at" timestamptz,
  "reason" text NOT NULL CHECK (length(trim("reason")) >= 3),
  "expires_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "app_permission_overrides_user_active_idx" ON "app_user_permission_overrides" ("user_id","active");
CREATE INDEX IF NOT EXISTS "app_permission_overrides_expires_idx" ON "app_user_permission_overrides" ("expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "app_permission_overrides_active_idx"
  ON "app_user_permission_overrides" ("user_id","permission_id") WHERE "active" = true;

INSERT INTO "app_permissions" ("key","description")
SELECT key, replace(key, '.', ' ') FROM unnest(ARRAY[
  'app.access',
  'projects.access',
  'editor.access',
  'exports.access',
  'render.access',
  'internal.diagnostics.access',
  'maintenance.bypass'
]) AS key ON CONFLICT ("key") DO NOTHING;

INSERT INTO "app_roles" ("key","name","description") VALUES
  ('member','Member','Normal Capinsta product access.'),
  ('developer','Developer','Temporary developer diagnostics and maintenance bypass access.')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "app_role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM "app_roles" r JOIN "app_permissions" p ON p.key = ANY(ARRAY[
  'app.access','projects.access','editor.access','exports.access','render.access'
]) WHERE r.key = 'member' ON CONFLICT DO NOTHING;

INSERT INTO "app_role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM "app_roles" r JOIN "app_permissions" p ON p.key = ANY(ARRAY[
  'app.access','projects.access','editor.access','exports.access','render.access',
  'internal.diagnostics.access','maintenance.bypass'
]) WHERE r.key = 'developer' ON CONFLICT DO NOTHING;

INSERT INTO "admin_permissions" ("key","description")
SELECT key, replace(key, '.', ' ') FROM unnest(ARRAY[
  'access.read',
  'access.manage_users',
  'access.manage_permissions',
  'access.manage_site_mode'
]) AS key ON CONFLICT ("key") DO NOTHING;

INSERT INTO "admin_role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM "admin_roles" r CROSS JOIN "admin_permissions" p
WHERE r.key = 'super_admin'
  AND p.key IN ('access.read','access.manage_users','access.manage_permissions','access.manage_site_mode')
ON CONFLICT DO NOTHING;

INSERT INTO "admin_role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM "admin_roles" r JOIN "admin_permissions" p ON p.key = 'access.read'
WHERE r.key = 'operations' ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION private.sync_capinsta_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE provider_name text;
BEGIN
  SELECT provider INTO provider_name
  FROM auth.identities
  WHERE user_id = NEW.id
  ORDER BY created_at ASC
  LIMIT 1;

  INSERT INTO public.profiles (
    user_id,
    email_snapshot,
    display_name,
    product_access_status,
    auth_provider_snapshot,
    email_confirmed_at,
    last_sign_in_at,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    'pending',
    provider_name,
    NEW.email_confirmed_at,
    NEW.last_sign_in_at,
    NEW.created_at,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email_snapshot = EXCLUDED.email_snapshot,
    display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
    auth_provider_snapshot = COALESCE(EXCLUDED.auth_provider_snapshot, public.profiles.auth_provider_snapshot),
    email_confirmed_at = EXCLUDED.email_confirmed_at,
    last_sign_in_at = EXCLUDED.last_sign_in_at,
    updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS "capinsta_auth_user_profile" ON auth.users;
    CREATE TRIGGER "capinsta_auth_user_profile"
      AFTER INSERT OR UPDATE OF email, email_confirmed_at, last_sign_in_at ON auth.users
      FOR EACH ROW EXECUTE FUNCTION private.sync_capinsta_profile();

    INSERT INTO "profiles" (
      "user_id","email_snapshot","display_name","product_access_status",
      "auth_provider_snapshot","email_confirmed_at","last_sign_in_at","created_at","updated_at"
    )
    SELECT
      u.id,
      u.email,
      coalesce(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
      'approved',
      i.provider,
      u.email_confirmed_at,
      u.last_sign_in_at,
      u.created_at,
      now()
    FROM auth.users u
    LEFT JOIN LATERAL (
      SELECT provider FROM auth.identities WHERE user_id = u.id ORDER BY created_at ASC LIMIT 1
    ) i ON true
    ON CONFLICT ("user_id") DO UPDATE SET
      "email_snapshot" = EXCLUDED."email_snapshot",
      "auth_provider_snapshot" = COALESCE(EXCLUDED."auth_provider_snapshot", profiles."auth_provider_snapshot"),
      "email_confirmed_at" = EXCLUDED."email_confirmed_at",
      "last_sign_in_at" = EXCLUDED."last_sign_in_at",
      "updated_at" = now();
  END IF;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'site_access_policy','app_roles','app_permissions','app_role_permissions',
    'app_role_members','app_user_permission_overrides'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
    END IF;
  END LOOP;
END $$;
