import { readFileSync } from "node:fs";
import { join } from "node:path";

const containerName = `capinsta-migration-check-${Date.now()}`;
const migrations = [
	"0005_rbac_product_access_hardening.sql",
	"0006_product_access_entitlements.sql",
	"0007_billing_auth_entitlements.sql",
];

async function run(command: string[], options: { input?: string; allowFailure?: boolean } = {}) {
	const proc = Bun.spawn(command, {
		stdin: options.input ? "pipe" : "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	if (options.input && proc.stdin) {
		proc.stdin.write(options.input);
		proc.stdin.end();
	}
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0 && !options.allowFailure) {
		throw new Error(
			`Command failed (${exitCode}): ${command.join(" ")}\n${stdout}\n${stderr}`,
		);
	}
	return { stdout, stderr, exitCode };
}

async function psql(sql: string, label: string) {
	console.log(`\n[db-check] ${label}`);
	await run(
		[
			"docker",
			"exec",
			"-i",
			containerName,
			"psql",
			"-v",
			"ON_ERROR_STOP=1",
			"-U",
			"postgres",
			"-d",
			"postgres",
		],
		{ input: sql },
	);
}

async function waitForPostgres() {
	const startedAt = Date.now();
	while (Date.now() - startedAt < 60_000) {
		const result = await run(
			[
				"docker",
				"exec",
				containerName,
				"pg_isready",
				"-U",
				"postgres",
				"-d",
				"postgres",
			],
			{ allowFailure: true },
		);
		if (result.exitCode === 0) return;
		await Bun.sleep(1_000);
	}
	throw new Error("Postgres container did not become ready within 60 seconds.");
}

const bootstrapSql = String.raw`
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  description text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.app_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.app_role_permissions (
  role_id uuid NOT NULL REFERENCES public.app_roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.app_permissions(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS public.admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT 'Admin'
);
CREATE TABLE IF NOT EXISTS public.admin_role_members (
  user_id uuid NOT NULL,
  role_id uuid NOT NULL REFERENCES public.admin_roles(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY,
  display_name text,
  email_snapshot text,
  product_access_status text NOT NULL DEFAULT 'pending',
  account_status text NOT NULL DEFAULT 'active',
  auth_provider_snapshot text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.caption_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE IF NOT EXISTS public.export_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE IF NOT EXISTS public.project_registry (project_id text PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE IF NOT EXISTS public.usage_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE IF NOT EXISTS public.usage_daily_rollups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE IF NOT EXISTS public.support_cases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);

INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000010', 'existing@example.test', '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000011', 'existing-free-missing@example.test', '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (user_id, email_snapshot, product_access_status, account_status)
VALUES ('00000000-0000-0000-0000-000000000099', 'profile-only@example.test', 'approved', 'active')
ON CONFLICT (user_id) DO NOTHING;
`;

const validationSql = String.raw`
GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
VALUES ('00000000-0000-0000-0000-000000000020', 'new-no-metadata@example.test', '{}'::jsonb, '{}'::jsonb);

DO $$
DECLARE profile_count integer; free_count integer; orphan_count integer;
BEGIN
  SELECT count(*) INTO profile_count FROM public.profiles WHERE user_id = '00000000-0000-0000-0000-000000000020';
  IF profile_count <> 1 THEN RAISE EXCEPTION 'new auth user profile count was %, expected 1', profile_count; END IF;

  SELECT count(*) INTO free_count FROM public.plan_entitlements
  WHERE user_id = '00000000-0000-0000-0000-000000000020'
    AND entitlement_key = 'free'
    AND status = 'active';
  IF free_count <> 1 THEN RAISE EXCEPTION 'new auth user free entitlement count was %, expected 1', free_count; END IF;

  SELECT count(*) INTO profile_count FROM public.profiles WHERE user_id = '00000000-0000-0000-0000-000000000010';
  IF profile_count <> 1 THEN RAISE EXCEPTION 'existing auth user profile backfill count was %, expected 1', profile_count; END IF;

  SELECT count(*) INTO free_count FROM public.plan_entitlements
  WHERE user_id = '00000000-0000-0000-0000-000000000011'
    AND entitlement_key = 'free'
    AND status = 'active';
  IF free_count <> 1 THEN RAISE EXCEPTION 'existing auth user free backfill count was %, expected 1', free_count; END IF;

  INSERT INTO public.plan_entitlements (user_id, entitlement_key, status, source)
  VALUES ('00000000-0000-0000-0000-000000000020', 'free', 'active', 'assertion')
  ON CONFLICT (user_id, entitlement_key) DO UPDATE SET status = excluded.status;

  SELECT count(*) INTO free_count FROM public.plan_entitlements
  WHERE user_id = '00000000-0000-0000-0000-000000000020' AND entitlement_key = 'free';
  IF free_count <> 1 THEN RAISE EXCEPTION 'duplicate free entitlement count was %, expected 1', free_count; END IF;

  SELECT count(*) INTO orphan_count FROM public.profile_auth_orphans
  WHERE user_id = '00000000-0000-0000-0000-000000000099';
  IF orphan_count <> 1 THEN RAISE EXCEPTION 'profile-only orphan count was %, expected 1', orphan_count; END IF;
END $$;

INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'user-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'user-b@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscriptions (user_id, provider_subscription_id, provider_plan_id, plan_key, status, amount_inr, currency)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'sub_a', 'plan_private', 'private_server', 'active', 800000, 'INR'),
  ('00000000-0000-0000-0000-0000000000b2', 'sub_b', 'plan_private', 'private_server', 'active', 800000, 'INR');

INSERT INTO public.donations (user_id, provider_order_id, amount_inr, currency, status)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'order_a', 100, 'INR', 'paid'),
  ('00000000-0000-0000-0000-0000000000b2', 'order_b', 250, 'INR', 'paid');

INSERT INTO public.payment_events (provider_event_id, event_type, signature_valid, payload)
VALUES ('evt_a', 'subscription.activated', true, '{}'::jsonb);

INSERT INTO public.dedicated_worker_provisioning_jobs (user_id, state, adapter)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'pending', 'manual'),
  ('00000000-0000-0000-0000-0000000000b2', 'pending', 'manual');

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

DO $$
DECLARE c integer;
BEGIN
  SELECT count(*) INTO c FROM public.profiles WHERE user_id = '00000000-0000-0000-0000-0000000000b2';
  IF c <> 0 THEN RAISE EXCEPTION 'user A could read user B profile'; END IF;

  SELECT count(*) INTO c FROM public.subscriptions WHERE user_id = '00000000-0000-0000-0000-0000000000b2';
  IF c <> 0 THEN RAISE EXCEPTION 'user A could read user B subscription'; END IF;

  SELECT count(*) INTO c FROM public.donations WHERE user_id = '00000000-0000-0000-0000-0000000000b2';
  IF c <> 0 THEN RAISE EXCEPTION 'user A could read user B donation'; END IF;

  SELECT count(*) INTO c FROM public.plan_entitlements WHERE user_id = '00000000-0000-0000-0000-0000000000b2';
  IF c <> 0 THEN RAISE EXCEPTION 'user A could read user B entitlement'; END IF;

  SELECT count(*) INTO c FROM public.dedicated_worker_provisioning_jobs WHERE user_id = '00000000-0000-0000-0000-0000000000b2';
  IF c <> 0 THEN RAISE EXCEPTION 'user A could read user B worker job'; END IF;

  SELECT count(*) INTO c FROM public.payment_events;
  RAISE EXCEPTION 'normal user unexpectedly read payment_events';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

DO $$
BEGIN
  INSERT INTO public.subscriptions (user_id, provider_subscription_id, plan_key, status, amount_inr)
  VALUES ('00000000-0000-0000-0000-0000000000a1', 'sub_fake', 'private_server', 'active', 800000);
  RAISE EXCEPTION 'normal user unexpectedly inserted subscription';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

DO $$
BEGIN
  UPDATE public.plan_entitlements SET status = 'active'
  WHERE user_id = '00000000-0000-0000-0000-0000000000a1' AND entitlement_key = 'private_server';
  RAISE EXCEPTION 'normal user unexpectedly updated entitlement';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

RESET ROLE;

SET ROLE service_role;
INSERT INTO public.payment_events (provider_event_id, event_type, signature_valid, payload)
VALUES ('evt_service', 'payment.captured', true, '{}'::jsonb);
UPDATE public.dedicated_worker_provisioning_jobs
SET state = 'provisioning'
WHERE user_id = '00000000-0000-0000-0000-0000000000a1';
RESET ROLE;
`;

try {
	await run([
		"docker",
		"run",
		"-d",
		"--rm",
		"--name",
		containerName,
		"-e",
		"POSTGRES_PASSWORD=postgres",
		"postgres:16-alpine",
	]);
	await waitForPostgres();
	await psql(bootstrapSql, "bootstrap Supabase-compatible roles and base tables");
	for (const migration of migrations) {
		const sql = readFileSync(join("migrations", migration), "utf8");
		await psql(sql, `apply ${migration}`);
	}
	await psql(validationSql, "run trigger, backfill, orphan, RLS, and service-role assertions");
	console.log("\n[db-check] PASS: billing/auth migrations applied and validated in disposable Postgres.");
} finally {
	await run(["docker", "rm", "-f", containerName], { allowFailure: true });
}
