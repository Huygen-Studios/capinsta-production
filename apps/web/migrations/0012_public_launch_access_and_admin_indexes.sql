-- Backward-compatible launch access hardening. Existing rows are preserved.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('active','suspended','restricted','banned','security_blocked','disabled','deletion_scheduled','deleted')) NOT VALID;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_account_status_check;

CREATE INDEX IF NOT EXISTS product_events_created_at_idx ON public.product_events (created_at DESC);
CREATE INDEX IF NOT EXISTS product_events_event_name_created_idx ON public.product_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS caption_jobs_status_created_desc_idx ON public.caption_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS export_jobs_status_created_desc_idx ON public.export_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS project_registry_created_at_idx ON public.project_registry (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_created_idx ON public.admin_audit_log (target_type, target_id, created_at DESC);
