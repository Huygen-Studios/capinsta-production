CREATE SCHEMA IF NOT EXISTS private;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "profiles" (
  "user_id" uuid PRIMARY KEY,
  "display_name" text,
  "email_snapshot" text,
  "account_status" text NOT NULL DEFAULT 'active' CHECK ("account_status" IN ('active','suspended','deletion_scheduled','deleted')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz,
  "suspended_at" timestamptz,
  "suspension_reason" text,
  "scheduled_deletion_at" timestamptz,
  "admin_mfa_reset_required" boolean NOT NULL DEFAULT false
);
CREATE INDEX "profiles_status_created_idx" ON "profiles" ("account_status","created_at");
CREATE INDEX "profiles_email_idx" ON "profiles" (lower("email_snapshot"));

CREATE TABLE "admin_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "admin_permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL UNIQUE,
  "description" text NOT NULL
);
CREATE TABLE "admin_role_permissions" (
  "role_id" uuid NOT NULL REFERENCES "admin_roles"("id") ON DELETE CASCADE,
  "permission_id" uuid NOT NULL REFERENCES "admin_permissions"("id") ON DELETE CASCADE,
  PRIMARY KEY ("role_id","permission_id")
);
CREATE TABLE "admin_role_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "role_id" uuid NOT NULL REFERENCES "admin_roles"("id"),
  "active" boolean NOT NULL DEFAULT true,
  "assigned_by" uuid,
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_by" uuid,
  "revoked_at" timestamptz,
  "reason" text NOT NULL CHECK (length(trim("reason")) >= 3)
);
CREATE INDEX "admin_role_members_user_active_idx" ON "admin_role_members" ("user_id","active");
CREATE UNIQUE INDEX "admin_role_members_active_role_idx" ON "admin_role_members" ("user_id","role_id") WHERE "active" = true;

CREATE TABLE "caption_jobs" (
  "id" text PRIMARY KEY,
  "user_id" uuid,
  "project_id" text,
  "source_filename" text NOT NULL,
  "language" text,
  "provider" text,
  "media_duration_seconds" numeric,
  "status" text NOT NULL,
  "progress" integer NOT NULL DEFAULT 0 CHECK ("progress" BETWEEN -1 AND 100),
  "word_count" integer,
  "caption_count" integer,
  "queued_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  "retry_count" integer NOT NULL DEFAULT 0,
  "retry_of_job_id" text,
  "admin_retry_by" uuid,
  "provider_request_id" text,
  "estimated_cost" numeric(12,6),
  "sanitized_error_code" text,
  "sanitized_error_message" text,
  "diagnostic_reference" text,
  "correlation_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "caption_jobs_user_created_idx" ON "caption_jobs" ("user_id","created_at");
CREATE INDEX "caption_jobs_status_created_idx" ON "caption_jobs" ("status","created_at");
CREATE INDEX "caption_jobs_provider_created_idx" ON "caption_jobs" ("provider","created_at");
CREATE INDEX "caption_jobs_project_idx" ON "caption_jobs" ("project_id");
CREATE INDEX "caption_jobs_correlation_idx" ON "caption_jobs" ("correlation_id");

CREATE TABLE "export_jobs" (
  "id" text PRIMARY KEY,
  "user_id" uuid,
  "project_id" text,
  "source_caption_job_id" text,
  "mode" text,
  "status" text NOT NULL,
  "stage" text,
  "progress" integer NOT NULL DEFAULT 0 CHECK ("progress" BETWEEN -1 AND 100),
  "queue_position" integer,
  "width" integer,
  "height" integer,
  "fps" integer,
  "duration_seconds" numeric,
  "output_size_bytes" bigint,
  "render_time_seconds" numeric,
  "queued_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  "retry_count" integer NOT NULL DEFAULT 0,
  "retry_of_export_id" text,
  "admin_retry_by" uuid,
  "immutable_input" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("immutable_input") = 'object'),
  "error_class" text,
  "sanitized_error_message" text,
  "output_expiry" timestamptz,
  "correlation_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "export_jobs_user_created_idx" ON "export_jobs" ("user_id","created_at");
CREATE INDEX "export_jobs_status_created_idx" ON "export_jobs" ("status","created_at");
CREATE INDEX "export_jobs_project_idx" ON "export_jobs" ("project_id");
CREATE INDEX "export_jobs_correlation_idx" ON "export_jobs" ("correlation_id");

CREATE TABLE "project_registry" (
  "project_id" text PRIMARY KEY,
  "user_id" uuid,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "last_heartbeat_at" timestamptz,
  "expires_at" timestamptz,
  "state" text NOT NULL DEFAULT 'active',
  "approximate_bytes" bigint,
  "media_count" integer NOT NULL DEFAULT 0,
  "caption_count" integer NOT NULL DEFAULT 0,
  "caption_job_count" integer NOT NULL DEFAULT 0,
  "export_job_count" integer NOT NULL DEFAULT 0,
  "cleanup_status" text,
  "cleanup_started_at" timestamptz,
  "cleanup_completed_at" timestamptz,
  "retention_hold" boolean NOT NULL DEFAULT false,
  "retention_hold_reason" text
);
CREATE INDEX "project_registry_user_updated_idx" ON "project_registry" ("user_id","updated_at");
CREATE INDEX "project_registry_expires_idx" ON "project_registry" ("expires_at");
CREATE INDEX "project_registry_state_idx" ON "project_registry" ("state");

CREATE TABLE "usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_key" text NOT NULL UNIQUE,
  "user_id" uuid,
  "project_id" text,
  "event_type" text NOT NULL,
  "numeric_value" numeric,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("metadata") = 'object'),
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "correlation_id" uuid
);
CREATE INDEX "usage_events_type_occurred_idx" ON "usage_events" ("event_type","occurred_at");
CREATE INDEX "usage_events_user_occurred_idx" ON "usage_events" ("user_id","occurred_at");
CREATE TABLE "usage_daily_rollups" (
  "date" date NOT NULL,
  "user_id" uuid,
  "metric" text NOT NULL,
  "value" numeric NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "usage_daily_rollups_unique_idx" ON "usage_daily_rollups" ("date","user_id","metric");

CREATE TABLE "provider_health_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" text NOT NULL,
  "component" text NOT NULL,
  "status" text NOT NULL,
  "latency_ms" integer,
  "sanitized_error" text,
  "checked_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "provider_health_latest_idx" ON "provider_health_events" ("provider","component","checked_at");

CREATE TABLE "feature_flags" (
  "key" text PRIMARY KEY,
  "description" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "scope" text NOT NULL DEFAULT 'global',
  "configuration" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("configuration") = 'object'),
  "updated_by" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1
);
CREATE TABLE "feature_flag_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL,
  "enabled" boolean NOT NULL,
  "configuration" jsonb NOT NULL CHECK (jsonb_typeof("configuration") = 'object'),
  "version" integer NOT NULL,
  "changed_by" uuid,
  "reason" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "feature_flag_versions_key_version_idx" ON "feature_flag_versions" ("key","version");
CREATE TABLE "system_settings" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "description" text NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "user_quotas" (
  "user_id" uuid PRIMARY KEY,
  "daily_caption_minutes" integer NOT NULL DEFAULT 60 CHECK ("daily_caption_minutes" BETWEEN 0 AND 100000),
  "daily_export_minutes" integer NOT NULL DEFAULT 60 CHECK ("daily_export_minutes" BETWEEN 0 AND 100000),
  "max_upload_duration_seconds" integer NOT NULL DEFAULT 1800 CHECK ("max_upload_duration_seconds" BETWEEN 1 AND 86400),
  "max_concurrent_caption_jobs" integer NOT NULL DEFAULT 2 CHECK ("max_concurrent_caption_jobs" BETWEEN 1 AND 100),
  "max_concurrent_export_jobs" integer NOT NULL DEFAULT 1 CHECK ("max_concurrent_export_jobs" BETWEEN 1 AND 100),
  "updated_by" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "support_cases" (
  "id" text PRIMARY KEY,
  "user_id" uuid,
  "email_snapshot" text,
  "category" text NOT NULL DEFAULT 'general',
  "status" text NOT NULL DEFAULT 'new' CHECK ("status" IN ('new','investigating','waiting_for_user','resolved','closed')),
  "priority" text NOT NULL DEFAULT 'normal',
  "assignee_user_id" uuid,
  "message" text NOT NULL,
  "internal_notes" text,
  "page" text,
  "feature" text,
  "browser" text,
  "app_version" text,
  "project_id" text,
  "caption_job_id" text,
  "export_job_id" text,
  "resolution" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz
);
CREATE INDEX "support_cases_status_priority_idx" ON "support_cases" ("status","priority","created_at");
CREATE INDEX "support_cases_assignee_idx" ON "support_cases" ("assignee_user_id","updated_at");
CREATE INDEX "support_cases_user_idx" ON "support_cases" ("user_id","created_at");
DO $$
BEGIN
  IF to_regclass('public.feedback') IS NOT NULL THEN
    INSERT INTO "support_cases" ("id","message","created_at","updated_at")
    SELECT "id","message","created_at","created_at" FROM "feedback"
    ON CONFLICT ("id") DO NOTHING;
  END IF;
END $$;
CREATE TABLE "support_case_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" text NOT NULL REFERENCES "support_cases"("id") ON DELETE CASCADE,
  "admin_user_id" uuid,
  "action" text NOT NULL,
  "before_value" jsonb,
  "after_value" jsonb,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "support_case_events_case_created_idx" ON "support_case_events" ("case_id","created_at");

CREATE TABLE "admin_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_user_id" uuid,
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "reason" text,
  "before_value" jsonb,
  "after_value" jsonb,
  "request_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "session_fingerprint" text,
  "ip_representation" text,
  "user_agent_summary" text,
  "success" boolean NOT NULL,
  "failure_code" text,
  "severity" text NOT NULL DEFAULT 'info',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "admin_audit_actor_created_idx" ON "admin_audit_log" ("admin_user_id","created_at");
CREATE INDEX "admin_audit_action_created_idx" ON "admin_audit_log" ("action","created_at");
CREATE INDEX "admin_audit_target_idx" ON "admin_audit_log" ("target_type","target_id");
CREATE INDEX "admin_audit_correlation_idx" ON "admin_audit_log" ("correlation_id");

CREATE TABLE "admin_security_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type" text NOT NULL,
  "ip_hash" text,
  "protected_ip" text,
  "email_hash" text,
  "attempt_count" integer NOT NULL DEFAULT 1,
  "severity" text NOT NULL DEFAULT 'medium',
  "blocked_until" timestamptz,
  "resolved_at" timestamptz,
  "resolved_by" uuid,
  "resolution_reason" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("metadata") = 'object'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "admin_security_active_blocks_idx" ON "admin_security_events" ("blocked_until","resolved_at");
CREATE INDEX "admin_security_type_created_idx" ON "admin_security_events" ("event_type","created_at");
CREATE INDEX "admin_security_ip_hash_idx" ON "admin_security_events" ("ip_hash");

CREATE TABLE "admin_fresh_mfa" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_user_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "verified_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "admin_fresh_mfa_session_idx" ON "admin_fresh_mfa" ("admin_user_id","session_id");
CREATE INDEX "admin_fresh_mfa_expires_idx" ON "admin_fresh_mfa" ("expires_at");

CREATE OR REPLACE FUNCTION private.sync_capinsta_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email_snapshot, display_name, created_at, updated_at)
  VALUES (NEW.id, NEW.email, coalesce(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name'), NEW.created_at, now())
  ON CONFLICT (user_id) DO UPDATE SET email_snapshot = EXCLUDED.email_snapshot, updated_at = now();
  RETURN NEW;
END;
$$;
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS "capinsta_auth_user_profile" ON auth.users;
    CREATE TRIGGER "capinsta_auth_user_profile" AFTER INSERT OR UPDATE OF email ON auth.users
    FOR EACH ROW EXECUTE FUNCTION private.sync_capinsta_profile();
    INSERT INTO "profiles" ("user_id","email_snapshot","display_name","created_at","updated_at")
    SELECT id,email,coalesce(raw_user_meta_data->>'display_name',raw_user_meta_data->>'name'),created_at,now() FROM auth.users
    ON CONFLICT ("user_id") DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.prevent_admin_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$ BEGIN RAISE EXCEPTION 'admin audit records are append-only'; END; $$;
CREATE TRIGGER "admin_audit_append_only" BEFORE UPDATE OR DELETE ON "admin_audit_log"
FOR EACH ROW EXECUTE FUNCTION private.prevent_admin_audit_mutation();

CREATE OR REPLACE FUNCTION private.prevent_last_super_admin_removal() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE target_role text;
DECLARE remaining integer;
BEGIN
  SELECT key INTO target_role FROM public.admin_roles WHERE id = OLD.role_id;
  IF target_role = 'super_admin' AND OLD.active = true AND (TG_OP = 'DELETE' OR NEW.active = false) THEN
    SELECT count(*) INTO remaining
    FROM public.admin_role_members m
    JOIN public.admin_roles r ON r.id = m.role_id
    JOIN public.profiles p ON p.user_id = m.user_id
    WHERE r.key = 'super_admin' AND m.active = true
      AND p.account_status = 'active' AND m.id <> OLD.id;
    IF remaining < 1 THEN RAISE EXCEPTION 'cannot remove final active super-admin'; END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER "protect_final_super_admin"
BEFORE UPDATE OF active OR DELETE ON "admin_role_members"
FOR EACH ROW EXECUTE FUNCTION private.prevent_last_super_admin_removal();

INSERT INTO "admin_roles" ("key","name","description") VALUES
('super_admin','Super Admin','Full administrative access.'),
('operations','Operations','Operational job and system management.'),
('support','Support','User and support case assistance.'),
('analyst','Analyst','Read-only operational analytics.'),
('content_manager','Content Manager','Approved content and preset configuration.')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "admin_permissions" ("key","description")
SELECT key, replace(key, '_', ' ') FROM unnest(ARRAY[
'users.read','users.suspend','users.restore','users.export_data','users.schedule_delete','users.manage_roles',
'projects.read','projects.extend_retention','projects.delete_temp_assets',
'caption_jobs.read','caption_jobs.cancel','caption_jobs.retry','caption_jobs.download_diagnostics',
'exports.read','exports.cancel','exports.retry','exports.delete_output',
'feedback.read','feedback.manage','feedback.assign',
'system.read','system.manage_limits','system.manage_providers',
'feature_flags.read','feature_flags.manage',
'security.read','security.unblock_ip','security.reset_admin_mfa','audit.read'
]) AS key ON CONFLICT ("key") DO NOTHING;

INSERT INTO "admin_role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM "admin_roles" r CROSS JOIN "admin_permissions" p WHERE r.key='super_admin'
ON CONFLICT DO NOTHING;
INSERT INTO "admin_role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM "admin_roles" r JOIN "admin_permissions" p ON p.key = ANY(ARRAY[
'users.read','projects.read','projects.extend_retention','projects.delete_temp_assets','caption_jobs.read','caption_jobs.cancel',
'caption_jobs.retry','caption_jobs.download_diagnostics','exports.read','exports.cancel','exports.retry','exports.delete_output',
'system.read','feature_flags.read']) WHERE r.key='operations' ON CONFLICT DO NOTHING;
INSERT INTO "admin_role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM "admin_roles" r JOIN "admin_permissions" p ON p.key = ANY(ARRAY[
'users.read','projects.read','caption_jobs.read','exports.read','feedback.read','feedback.manage','feedback.assign'])
WHERE r.key='support' ON CONFLICT DO NOTHING;
INSERT INTO "admin_role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM "admin_roles" r JOIN "admin_permissions" p ON p.key = ANY(ARRAY[
'users.read','projects.read','caption_jobs.read','exports.read','feedback.read','system.read','feature_flags.read','audit.read'])
WHERE r.key='analyst' ON CONFLICT DO NOTHING;
INSERT INTO "admin_role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM "admin_roles" r JOIN "admin_permissions" p ON p.key = ANY(ARRAY['feature_flags.read','feature_flags.manage'])
WHERE r.key='content_manager' ON CONFLICT DO NOTHING;

INSERT INTO "feature_flags" ("key","description","enabled","scope","configuration") VALUES
('registration_enabled','Allow new account registration',true,'global','{}'),
('caption_generation_enabled','Allow new caption jobs',true,'global','{}'),
('export_enabled','Allow new export jobs',true,'global','{}'),
('maintenance_mode','Display maintenance mode and prevent new work',false,'global','{}'),
('sample_import_enabled','Allow sample project import',false,'global','{}'),
('advertisements_enabled','Enable approved advertisements',false,'global','{}'),
('provider_controls','Configured speech-to-text provider availability',true,'global','{"groq":true,"openai":true,"sarvam":true}')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "system_settings" ("key","value","description") VALUES
('maximum_upload_duration_seconds','1800','Maximum accepted media duration in seconds'),
('daily_caption_minutes','60','Default daily caption minutes per user'),
('daily_export_minutes','60','Default daily export minutes per user'),
('maximum_concurrent_caption_jobs','2','Default concurrent caption jobs per user'),
('maximum_concurrent_export_jobs','1','Default concurrent export jobs per user'),
('global_export_concurrency','1','Maximum globally active export jobs'),
('project_retention_days','1','Default server project retention duration in days')
ON CONFLICT ("key") DO NOTHING;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles','admin_roles','admin_permissions','admin_role_permissions','admin_role_members',
    'caption_jobs','export_jobs','project_registry','usage_events','usage_daily_rollups',
    'provider_health_events','feature_flags','feature_flag_versions','system_settings','user_quotas','support_cases','support_case_events',
    'admin_audit_log','admin_security_events','admin_fresh_mfa'
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
