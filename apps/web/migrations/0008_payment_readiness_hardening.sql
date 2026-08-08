-- Payment readiness hardening.
-- Prevent duplicate open Private Server subscription attempts per user/product.

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_one_open_private_server_idx"
  ON "subscriptions" ("user_id", "plan_key")
  WHERE "status" IN (
    'authorization_pending',
    'authenticated',
    'active',
    'pending',
    'provisioning_pending',
    'provisioning'
  );
