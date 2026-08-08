# CapInsta RBAC Production Verification

This checklist must be run with two real accounts:

- Account A: active `super_admin`
- Account B: approved normal member

Do not mark RBAC production-ready until Account B can upload/export only its own files and receives 401/403/404 from every admin and cross-user endpoint.

## Preflight

1. Take a Supabase backup or snapshot.
2. Run `docs/rbac-production-verification.sql`.
3. Confirm `retained_super_admin_count >= 1`.
4. Confirm role tables have no `anon` or `authenticated` INSERT/UPDATE/DELETE grants.
5. Confirm every CapInsta user-media bucket is private.
6. Confirm existing storage object paths match:

```text
<user_id>/<project_id>/<file>
```

Objects that do not match must not be exposed through public URLs. Move them through a reviewed migration or deny direct access until migrated.

## Account B: Approved Member

Expected state:

- Users table `Admin = No`
- product access `approved`
- effective product role includes `member`
- no active admin roles

Browser checks:

1. Sign in as Account B.
2. Create a project.
3. Upload a video.
4. Generate captions.
5. Render/export.
6. Download the export.
7. Confirm the files are under Account B's project only.

Direct HTTP checks:

1. `GET /admincapinsta11` must be denied.
2. `POST /api/admin/mutations` must be denied.
3. `GET /api/admin/diagnostics?...` must be denied.
4. `GET /api/capinsta/api/jobs/{other_user_job}` must return 404/403.
5. `GET /api/capinsta/api/media/assets/{other_user_asset}/content` must return 404/403.
6. `GET /api/capinsta/api/export/jobs/{other_user_export}` must return 404/403.
7. Direct Supabase Storage read/write/delete outside `<account_b_user_id>/...` must fail.

## Account A: Super Admin

1. Sign in as Account A.
2. Confirm admin pages load.
3. Approve/revoke product access for a test user.
4. Assign/revoke `member` app role where supported.
5. Assign/revoke admin roles only as `super_admin`.
6. Verify self-promotion/self-role-change is denied.
7. Verify removing the last active `super_admin` is denied.
8. Verify audit rows contain actor, target, action, old/new state, reason, timestamp, and correlation id.

## Session Invalidation

After downgrading Account B:

1. Revoke sessions using the admin mutation `user.sessions.revoke`, or run the equivalent server-side Supabase Admin API call.
2. Ask the user to sign out and sign in again.
3. Verify privileged requests perform server-side role lookup on every call and do not trust stale JWT role claims.

Current code path performs admin lookup from `admin_role_members` on every admin request; app permissions are loaded from `app_role_members` on protected app/API requests.

## Deployment Order

1. Backup/preflight.
2. Apply `apps/web/migrations/0005_rbac_product_access_hardening.sql`.
3. Deploy backend/frontend.
4. Run `docs/rbac-approved-member-remediation.sql` as dry run.
5. Confirm retained super admin and target user.
6. Change final `ROLLBACK` to `COMMIT` and execute remediation.
7. Revoke sessions for the remediated account.
8. Run Account A/B smoke tests.
9. Monitor backend logs for `auth_allow` and `auth_reject` reason codes.

## Rollback

1. Revert app deployment to the previous image.
2. Do not roll back the super-admin final-account protection.
3. If storage RLS blocks legitimate traffic, disable only the new storage policies temporarily after confirming buckets remain private.
4. Restore any accidentally revoked admin role only from the preflight output and only as an explicit `super_admin` action with audit reason.
