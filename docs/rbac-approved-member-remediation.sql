-- Safe one-time remediation for an approved editor user who was accidentally
-- left with admin membership. Review the preflight result before committing.
--
-- Usage:
-- 1. Replace target.email below.
-- 2. Run as a dry run first; this script ends with ROLLBACK by default.
-- 3. Confirm retained_super_admin_count >= 1 and target_user_id is correct.
-- 4. Change the final ROLLBACK to COMMIT and run once.
--
-- Rollback note:
--   This downgrade records the removed admin_role_members rows in the preflight
--   output. To undo, reactivate only the specific intended memberships after
--   another super_admin approves that action with an audit reason.

BEGIN;

CREATE TEMP TABLE rbac_remediation_target(email text NOT NULL) ON COMMIT DROP;
INSERT INTO rbac_remediation_target(email)
VALUES ('replace-with-target-user-email@example.com');

WITH target AS (
  SELECT p.user_id, p.email_snapshot
  FROM profiles p
  JOIN rbac_remediation_target t ON lower(p.email_snapshot) = lower(t.email)
  LIMIT 1
),
retained_super_admins AS (
  SELECT count(*)::int AS count
  FROM admin_role_members m
  JOIN admin_roles r ON r.id = m.role_id
  JOIN profiles p ON p.user_id = m.user_id
  WHERE r.key = 'super_admin'
    AND m.active = true
    AND p.account_status = 'active'
    AND m.user_id <> (SELECT user_id FROM target)
),
target_admin_roles AS (
  SELECT r.key, m.id, m.active
  FROM admin_role_members m
  JOIN admin_roles r ON r.id = m.role_id
  WHERE m.user_id = (SELECT user_id FROM target)
    AND m.active = true
),
target_app_roles AS (
  SELECT r.key, m.id, m.active
  FROM app_role_members m
  JOIN app_roles r ON r.id = m.role_id
  WHERE m.user_id = (SELECT user_id FROM target)
    AND m.active = true
)
SELECT
  (SELECT user_id FROM target) AS target_user_id,
  (SELECT email_snapshot FROM target) AS target_email,
  (SELECT count FROM retained_super_admins) AS retained_super_admin_count,
  COALESCE(json_agg(DISTINCT target_admin_roles.key) FILTER (WHERE target_admin_roles.key IS NOT NULL), '[]'::json) AS active_admin_roles,
  COALESCE(json_agg(DISTINCT target_app_roles.key) FILTER (WHERE target_app_roles.key IS NOT NULL), '[]'::json) AS active_app_roles
FROM target
LEFT JOIN target_admin_roles ON true
LEFT JOIN target_app_roles ON true
GROUP BY target.user_id, target.email_snapshot;

DO $$
DECLARE
  target_user uuid;
  retained_super_admin_count integer;
BEGIN
  SELECT p.user_id INTO target_user
  FROM profiles p
  JOIN rbac_remediation_target t ON lower(p.email_snapshot) = lower(t.email)
  LIMIT 1;

  IF target_user IS NULL THEN
    RAISE EXCEPTION 'target user was not found';
  END IF;

  SELECT count(*)::int INTO retained_super_admin_count
  FROM admin_role_members m
  JOIN admin_roles r ON r.id = m.role_id
  JOIN profiles p ON p.user_id = m.user_id
  WHERE r.key = 'super_admin'
    AND m.active = true
    AND p.account_status = 'active'
    AND m.user_id <> target_user;

  IF retained_super_admin_count < 1 THEN
    RAISE EXCEPTION 'refusing to downgrade target because no other active super_admin remains';
  END IF;

  UPDATE admin_role_members
  SET active = false,
      revoked_at = now(),
      reason = COALESCE(reason, 'Downgraded to approved member during RBAC remediation.')
  WHERE user_id = target_user
    AND active = true;

  UPDATE profiles
  SET product_access_status = 'approved',
      product_access_approved_at = COALESCE(product_access_approved_at, now()),
      product_access_updated_at = now(),
      product_access_reason = 'Approved editor member after RBAC remediation.',
      updated_at = now()
  WHERE user_id = target_user;

  INSERT INTO app_role_members (user_id, role_id, reason)
  SELECT target_user, r.id, 'Approved editor member after RBAC remediation.'
  FROM app_roles r
  WHERE r.key = 'member'
    AND NOT EXISTS (
      SELECT 1
      FROM app_role_members existing
      WHERE existing.user_id = target_user
        AND existing.role_id = r.id
        AND existing.active = true
        AND (existing.expires_at IS NULL OR existing.expires_at > now())
    );
END $$;

SELECT
  p.user_id,
  p.email_snapshot,
  p.product_access_status,
  EXISTS (
    SELECT 1
    FROM admin_role_members m
    WHERE m.user_id = p.user_id AND m.active = true
  ) AS effective_admin,
  EXISTS (
    SELECT 1
    FROM app_role_members m
    JOIN app_roles r ON r.id = m.role_id
    WHERE m.user_id = p.user_id AND m.active = true AND r.key = 'member'
  ) AS has_member_role
FROM profiles p
JOIN rbac_remediation_target t ON lower(p.email_snapshot) = lower(t.email);

ROLLBACK;
-- COMMIT;
