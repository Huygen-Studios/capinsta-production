-- Stage 5 private-beta control plane. Additive only.

CREATE TABLE IF NOT EXISTS public.whop_account_links (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  whop_user_id text NOT NULL UNIQUE CHECK (length(whop_user_id) BETWEEN 6 AND 100),
  membership_id text UNIQUE CHECK (membership_id IS NULL OR length(membership_id) BETWEEN 6 AND 100),
  product_id text NOT NULL CHECK (length(product_id) BETWEEN 6 AND 100),
  plan_id text CHECK (plan_id IS NULL OR length(plan_id) BETWEEN 6 AND 100),
  entitlement_state text NOT NULL DEFAULT 'unknown'
    CHECK (entitlement_state IN ('unknown','active','grace_period','inactive','revoked')),
  event_timestamp timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whop_account_links_state_idx
  ON public.whop_account_links(entitlement_state, updated_at);

CREATE TABLE IF NOT EXISTS public.whop_webhook_events (
  event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 6 AND 160),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 3 AND 100),
  event_timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processed','ignored','failed')),
  whop_user_id text,
  membership_id text,
  product_id text,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 20),
  failure_code text,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS whop_webhook_events_status_received_idx
  ON public.whop_webhook_events(processing_status, received_at);

CREATE TABLE IF NOT EXISTS public.usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 160),
  user_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (length(resource_type) BETWEEN 2 AND 64),
  resource_id text NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 160),
  metric text NOT NULL CHECK (length(metric) BETWEEN 2 AND 64),
  quantity numeric NOT NULL CHECK (quantity >= 0),
  final_quantity numeric CHECK (final_quantity IS NULL OR final_quantity >= 0),
  unit text NOT NULL CHECK (unit IN ('count','minutes','bytes')),
  period_start date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','committed','released')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_reservations_user_metric_period_idx
  ON public.usage_reservations(user_id, metric, period_start, status);
CREATE INDEX IF NOT EXISTS usage_reservations_expiry_idx
  ON public.usage_reservations(expires_at) WHERE status = 'reserved';

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','deleting','completed','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  safe_failure_code text,
  storage_deleted boolean NOT NULL DEFAULT false,
  database_deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_deletion_requests_status_idx
  ON public.account_deletion_requests(status, requested_at);

INSERT INTO public.app_permissions(key, description)
VALUES ('clipper.access', 'Use the entitlement-protected Automatic Clipper')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_settings(key, value, description)
VALUES
  ('beta_candidate_regenerations', '5'::jsonb, 'Default daily candidate regenerations')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.whop_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whop_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whop_account_links, public.whop_webhook_events,
  public.usage_reservations, public.account_deletion_requests FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whop_account_links,
  public.whop_webhook_events, public.usage_reservations,
  public.account_deletion_requests TO service_role;

GRANT SELECT ON public.whop_account_links, public.usage_reservations,
  public.account_deletion_requests TO authenticated;

CREATE POLICY whop_account_links_service_role_all ON public.whop_account_links
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY whop_account_links_read_own ON public.whop_account_links
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY whop_webhook_events_service_role_all ON public.whop_webhook_events
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY usage_reservations_service_role_all ON public.usage_reservations
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY usage_reservations_read_own ON public.usage_reservations
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY account_deletion_requests_service_role_all ON public.account_deletion_requests
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY account_deletion_requests_read_own ON public.account_deletion_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid());
