-- RBAC/product-access hardening.
-- Roles and product entitlements are intentionally separate:
--   app_role_members/member grants editor capabilities after product approval.
--   admin_role_members grants administrative authority only.

INSERT INTO "app_permissions" ("key","description")
SELECT key, replace(key, '.', ' ') FROM unnest(ARRAY[
  'app.access',
  'projects.access',
  'editor.access',
  'exports.access',
  'render.access'
]) AS key ON CONFLICT ("key") DO NOTHING;

INSERT INTO "app_roles" ("key","name","description") VALUES
  ('member','Member','Normal approved Capinsta editor access.')
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO "app_role_permissions" ("role_id","permission_id")
SELECT r.id, p.id
FROM "app_roles" r
JOIN "app_permissions" p ON p.key = ANY(ARRAY[
  'app.access','projects.access','editor.access','exports.access','render.access'
])
WHERE r.key = 'member'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.capinsta_has_admin_role(required_role text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_role_members m
    JOIN public.admin_roles r ON r.id = m.role_id
    JOIN public.profiles p ON p.user_id = m.user_id
    WHERE m.user_id = auth.uid()
      AND m.active = true
      AND p.account_status = 'active'
      AND (required_role IS NULL OR r.key = required_role)
  );
$$;

REVOKE ALL ON FUNCTION public.capinsta_has_admin_role(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.capinsta_has_admin_role(text) TO authenticated;
  END IF;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles',
    'caption_jobs',
    'export_jobs',
    'project_registry',
    'usage_events',
    'usage_daily_rollups',
    'support_cases'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON "profiles";
CREATE POLICY "profiles_select_own_or_admin"
ON "profiles" FOR SELECT TO authenticated
USING ("user_id" = auth.uid() OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "profiles_update_own_non_admin" ON "profiles";

DROP POLICY IF EXISTS "caption_jobs_owner_select" ON "caption_jobs";
CREATE POLICY "caption_jobs_owner_select"
ON "caption_jobs" FOR SELECT TO authenticated
USING ("user_id" = auth.uid() OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "caption_jobs_owner_insert" ON "caption_jobs";
CREATE POLICY "caption_jobs_owner_insert"
ON "caption_jobs" FOR INSERT TO authenticated
WITH CHECK ("user_id" = auth.uid());

DROP POLICY IF EXISTS "caption_jobs_owner_update" ON "caption_jobs";
CREATE POLICY "caption_jobs_owner_update"
ON "caption_jobs" FOR UPDATE TO authenticated
USING ("user_id" = auth.uid())
WITH CHECK ("user_id" = auth.uid());

DROP POLICY IF EXISTS "caption_jobs_owner_delete" ON "caption_jobs";
CREATE POLICY "caption_jobs_owner_delete"
ON "caption_jobs" FOR DELETE TO authenticated
USING ("user_id" = auth.uid());

DROP POLICY IF EXISTS "export_jobs_owner_select" ON "export_jobs";
CREATE POLICY "export_jobs_owner_select"
ON "export_jobs" FOR SELECT TO authenticated
USING ("user_id" = auth.uid() OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "export_jobs_owner_insert" ON "export_jobs";
CREATE POLICY "export_jobs_owner_insert"
ON "export_jobs" FOR INSERT TO authenticated
WITH CHECK ("user_id" = auth.uid());

DROP POLICY IF EXISTS "export_jobs_owner_update" ON "export_jobs";
CREATE POLICY "export_jobs_owner_update"
ON "export_jobs" FOR UPDATE TO authenticated
USING ("user_id" = auth.uid())
WITH CHECK ("user_id" = auth.uid());

DROP POLICY IF EXISTS "export_jobs_owner_delete" ON "export_jobs";
CREATE POLICY "export_jobs_owner_delete"
ON "export_jobs" FOR DELETE TO authenticated
USING ("user_id" = auth.uid());

DROP POLICY IF EXISTS "project_registry_owner_select" ON "project_registry";
CREATE POLICY "project_registry_owner_select"
ON "project_registry" FOR SELECT TO authenticated
USING ("user_id" = auth.uid() OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "project_registry_owner_insert" ON "project_registry";
CREATE POLICY "project_registry_owner_insert"
ON "project_registry" FOR INSERT TO authenticated
WITH CHECK ("user_id" = auth.uid());

DROP POLICY IF EXISTS "project_registry_owner_update" ON "project_registry";
CREATE POLICY "project_registry_owner_update"
ON "project_registry" FOR UPDATE TO authenticated
USING ("user_id" = auth.uid())
WITH CHECK ("user_id" = auth.uid());

DROP POLICY IF EXISTS "project_registry_owner_delete" ON "project_registry";
CREATE POLICY "project_registry_owner_delete"
ON "project_registry" FOR DELETE TO authenticated
USING ("user_id" = auth.uid());

DROP POLICY IF EXISTS "usage_events_owner_select" ON "usage_events";
CREATE POLICY "usage_events_owner_select"
ON "usage_events" FOR SELECT TO authenticated
USING ("user_id" = auth.uid() OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "usage_events_owner_insert" ON "usage_events";
CREATE POLICY "usage_events_owner_insert"
ON "usage_events" FOR INSERT TO authenticated
WITH CHECK ("user_id" = auth.uid());

DROP POLICY IF EXISTS "usage_daily_rollups_owner_select" ON "usage_daily_rollups";
CREATE POLICY "usage_daily_rollups_owner_select"
ON "usage_daily_rollups" FOR SELECT TO authenticated
USING ("user_id" = auth.uid() OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "support_cases_owner_select" ON "support_cases";
CREATE POLICY "support_cases_owner_select"
ON "support_cases" FOR SELECT TO authenticated
USING ("user_id" = auth.uid() OR public.capinsta_has_admin_role(NULL));

DROP POLICY IF EXISTS "support_cases_owner_insert" ON "support_cases";
CREATE POLICY "support_cases_owner_insert"
ON "support_cases" FOR INSERT TO authenticated
WITH CHECK ("user_id" = auth.uid());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('capinsta-media', 'capinsta-media', false)
    ON CONFLICT (id) DO UPDATE SET public = false;

    EXECUTE 'DROP POLICY IF EXISTS "capinsta_storage_owner_select" ON storage.objects';
    EXECUTE 'CREATE POLICY "capinsta_storage_owner_select"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = ''capinsta-media''
        AND (
          public.capinsta_has_admin_role(NULL)
          OR (
            split_part(name, ''/'', 1) = auth.uid()::text
            AND EXISTS (
              SELECT 1 FROM public.project_registry pr
              WHERE pr.user_id = auth.uid()
                AND pr.project_id = split_part(name, ''/'', 2)
            )
          )
        )
      )';

    EXECUTE 'DROP POLICY IF EXISTS "capinsta_storage_owner_insert" ON storage.objects';
    EXECUTE 'CREATE POLICY "capinsta_storage_owner_insert"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = ''capinsta-media''
        AND split_part(name, ''/'', 1) = auth.uid()::text
        AND EXISTS (
          SELECT 1 FROM public.project_registry pr
          WHERE pr.user_id = auth.uid()
            AND pr.project_id = split_part(name, ''/'', 2)
        )
      )';

    EXECUTE 'DROP POLICY IF EXISTS "capinsta_storage_owner_update" ON storage.objects';
    EXECUTE 'CREATE POLICY "capinsta_storage_owner_update"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = ''capinsta-media''
        AND split_part(name, ''/'', 1) = auth.uid()::text
        AND EXISTS (
          SELECT 1 FROM public.project_registry pr
          WHERE pr.user_id = auth.uid()
            AND pr.project_id = split_part(name, ''/'', 2)
        )
      )
      WITH CHECK (
        bucket_id = ''capinsta-media''
        AND split_part(name, ''/'', 1) = auth.uid()::text
        AND EXISTS (
          SELECT 1 FROM public.project_registry pr
          WHERE pr.user_id = auth.uid()
            AND pr.project_id = split_part(name, ''/'', 2)
        )
      )';

    EXECUTE 'DROP POLICY IF EXISTS "capinsta_storage_owner_delete" ON storage.objects';
    EXECUTE 'CREATE POLICY "capinsta_storage_owner_delete"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = ''capinsta-media''
        AND split_part(name, ''/'', 1) = auth.uid()::text
        AND EXISTS (
          SELECT 1 FROM public.project_registry pr
          WHERE pr.user_id = auth.uid()
            AND pr.project_id = split_part(name, ''/'', 2)
        )
      )';
  END IF;
END $$;
