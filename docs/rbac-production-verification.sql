-- Production RBAC/storage preflight and postflight verification.
-- Read-only except for explicitly marked manual UPDATE statements.

-- 1. Current Supabase Storage buckets and public/private state.
SELECT id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at
FROM storage.buckets
ORDER BY name;

-- 2. Storage policies currently installed.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage'
ORDER BY tablename, policyname;

-- 3. Public or anonymous storage policies that must be reviewed before deploy.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND (
    'anon' = ANY(roles)
    OR 'public' = ANY(roles)
    OR qual ILIKE '%true%'
    OR with_check ILIKE '%true%'
  )
ORDER BY policyname;

-- 4. Existing object path audit for CapInsta media-like buckets.
-- Adjust the bucket list after step 1 identifies the real production names.
WITH object_audit AS (
  SELECT
    o.bucket_id,
    o.name,
    split_part(o.name, '/', 1) AS user_path_segment,
    split_part(o.name, '/', 2) AS project_path_segment,
    o.owner,
    o.created_at,
    CASE
      WHEN split_part(o.name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN 'bad_user_segment'
      WHEN split_part(o.name, '/', 2) = ''
        THEN 'missing_project_segment'
      WHEN NOT EXISTS (
        SELECT 1
        FROM public.project_registry pr
        WHERE pr.user_id::text = split_part(o.name, '/', 1)
          AND pr.project_id = split_part(o.name, '/', 2)
      )
        THEN 'no_matching_owned_project'
      ELSE 'ok'
    END AS path_status
  FROM storage.objects o
  WHERE o.bucket_id IN ('capinsta-media')
)
SELECT *
FROM object_audit
WHERE path_status <> 'ok'
ORDER BY bucket_id, created_at DESC
LIMIT 500;

-- 5. User-owned table RLS policy inventory.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles',
    'caption_jobs',
    'export_jobs',
    'project_registry',
    'usage_events',
    'usage_daily_rollups',
    'support_cases',
    'app_role_members',
    'admin_role_members',
    'app_roles',
    'admin_roles',
    'app_permissions',
    'admin_permissions',
    'app_role_permissions',
    'admin_role_permissions'
  )
ORDER BY tablename, policyname;

-- 6. Confirm browser clients cannot mutate role tables through grants.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'app_role_members',
    'admin_role_members',
    'app_roles',
    'admin_roles',
    'app_permissions',
    'admin_permissions',
    'app_role_permissions',
    'admin_role_permissions'
  )
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

-- 7. Confirm at least one active super_admin remains before any remediation.
SELECT count(*)::int AS retained_super_admin_count
FROM admin_role_members m
JOIN admin_roles r ON r.id = m.role_id
JOIN profiles p ON p.user_id = m.user_id
WHERE r.key = 'super_admin'
  AND m.active = true
  AND p.account_status = 'active';

-- 8. Check the target approved member after remediation.
-- Replace the email only while running this verification.
SELECT
  p.user_id,
  p.email_snapshot,
  p.account_status,
  p.product_access_status,
  EXISTS (
    SELECT 1 FROM app_role_members m
    JOIN app_roles r ON r.id = m.role_id
    WHERE m.user_id = p.user_id
      AND m.active = true
      AND r.key = 'member'
      AND (m.expires_at IS NULL OR m.expires_at > now())
  ) AS has_member_role,
  EXISTS (
    SELECT 1 FROM admin_role_members m
    WHERE m.user_id = p.user_id
      AND m.active = true
  ) AS has_admin_role
FROM profiles p
WHERE lower(p.email_snapshot) = lower('replace-with-member-email@example.com');

-- 9. Manual bucket lock-down template. Run only for verified CapInsta user-media buckets.
-- UPDATE storage.buckets SET public = false WHERE id IN ('capinsta-media');
