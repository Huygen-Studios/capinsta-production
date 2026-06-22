import { readFileSync } from "node:fs";
import postgres from "postgres";

const databaseUrl = process.env.ADMIN_MIGRATION_TEST_DATABASE_URL;
if (!databaseUrl) {
	console.error("ADMIN_MIGRATION_TEST_DATABASE_URL is required.");
	process.exit(2);
}
const parsed = new URL(databaseUrl);
const safeTarget =
	["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) ||
	/test|staging|stage|ci/i.test(parsed.pathname);
if (!safeTarget) {
	console.error(
		"Refusing to run migration verification against a database that is not clearly local, test, or staging.",
	);
	process.exit(2);
}

const sql = postgres(databaseUrl, { max: 1 });
const migration = readFileSync(
	new URL(
		"../migrations/0001_capinsta_admin_control_plane.sql",
		import.meta.url,
	),
	"utf8",
);

try {
	const existing =
		await sql`select to_regclass('public.profiles')::text as profiles`;
	if (!existing[0]?.profiles) await sql.unsafe(migration);
	const tables = await sql<{ table_name: string }[]>`
		select table_name from information_schema.tables
		where table_schema = 'public'
		  and table_name in (
		    'profiles','admin_roles','admin_permissions','admin_role_permissions',
		    'admin_role_members','caption_jobs','export_jobs','project_registry',
		    'usage_events','usage_daily_rollups','provider_health_events','feature_flags',
		    'feature_flag_versions','system_settings','user_quotas','support_cases',
		    'support_case_events','admin_audit_log','admin_security_events','admin_fresh_mfa'
		  )
	`;
	if (tables.length !== 20)
		throw new Error(`Expected 20 admin tables, found ${tables.length}.`);
	const seeds = await sql<{ roles: number; permissions: number }[]>`
		select
		  (select count(*)::int from admin_roles) roles,
		  (select count(*)::int from admin_permissions) permissions
	`;
	if (seeds[0].roles !== 5 || seeds[0].permissions !== 29) {
		throw new Error(`Unexpected seed counts: ${JSON.stringify(seeds[0])}`);
	}
	const role = await sql<
		{ id: string }[]
	>`select id from admin_roles where key = 'super_admin'`;
	const existingTestAdmins = await sql<{ user_id: string }[]>`
    select arm.user_id::text
    from admin_role_members arm
    join profiles p on p.user_id = arm.user_id
    where arm.role_id = ${role[0].id}::uuid
      and arm.active = true
      and p.email_snapshot = 'migration-test@example.invalid'
  `;
	const userId = existingTestAdmins[0]?.user_id ?? crypto.randomUUID();
	if (!existingTestAdmins.length) {
		await sql`insert into profiles (user_id, email_snapshot) values (${userId}::uuid, 'migration-test@example.invalid')`;
		await sql`insert into admin_role_members (user_id, role_id, assigned_by, reason) values (${userId}::uuid, ${role[0].id}::uuid, ${userId}::uuid, 'migration verification')`;
	}
	await sql`
    update admin_role_members arm
    set active = false, revoked_at = now()
    from profiles p
    where p.user_id = arm.user_id
      and arm.role_id = ${role[0].id}::uuid
      and arm.user_id <> ${userId}::uuid
      and p.email_snapshot = 'migration-test@example.invalid'
  `;
	let finalAdminProtected = false;
	try {
		await sql`update admin_role_members set active = false where user_id = ${userId}::uuid`;
	} catch {
		finalAdminProtected = true;
	}
	if (!finalAdminProtected)
		throw new Error("Final super-admin protection did not fire.");
	const requestId = crypto.randomUUID();
	await sql`
		insert into admin_audit_log
		  (admin_user_id, action, request_id, correlation_id, success)
		values (${userId}::uuid, 'migration.verify', ${requestId}::uuid, ${requestId}::uuid, true)
	`;
	let appendOnlyProtected = false;
	try {
		await sql`delete from admin_audit_log where request_id = ${requestId}::uuid`;
	} catch {
		appendOnlyProtected = true;
	}
	if (!appendOnlyProtected)
		throw new Error("Append-only audit protection did not fire.");
	let jsonProtected = false;
	try {
		await sql`insert into feature_flags (key, description, configuration) values ('invalid_json_shape', 'test', '[]'::jsonb)`;
	} catch {
		jsonProtected = true;
	}
	if (!jsonProtected) throw new Error("JSON shape constraint did not fire.");
	await sql
		.begin(async (transaction) => {
			await transaction`insert into support_cases (id, message) values ('rollback-test', 'test')`;
			throw new Error("intentional rollback");
		})
		.catch(() => undefined);
	const rollback =
		await sql`select 1 from support_cases where id = 'rollback-test'`;
	if (rollback.length)
		throw new Error("Transaction rollback verification failed.");
	console.log(
		JSON.stringify({
			ok: true,
			tables: tables.length,
			...seeds[0],
			appendOnlyProtected,
			finalAdminProtected,
			jsonProtected,
		}),
	);
} finally {
	await sql.end();
}
