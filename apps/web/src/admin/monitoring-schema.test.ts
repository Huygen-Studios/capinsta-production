import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const repoRoot = join(import.meta.dir, "..", "..");

function migrationSql() {
	return readFileSync(
		join(repoRoot, "migrations", "0010_product_events_monitoring.sql"),
		"utf8",
	);
}

describe("monitoring migration", () => {
	test("creates product events with idempotency, RLS, and auth signup trigger", () => {
		const sql = migrationSql();
		expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.product_events");
		expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS product_events_event_key_unique");
		expect(sql).toContain("ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY");
		expect(sql).toContain("AFTER INSERT ON auth.users");
		expect(sql).toContain("ON CONFLICT (event_key) DO NOTHING");
	});

	test("declares all required safe event names", () => {
		const sql = migrationSql();
		for (const eventName of [
			"signup_completed",
			"project_created",
			"media_upload_completed",
			"media_upload_failed",
			"caption_job_started",
			"caption_job_completed",
			"caption_job_failed",
			"export_started",
			"export_completed",
			"export_failed",
			"private_server_request_submitted",
			"donation_completed",
			"donation_failed",
			"donation_refunded",
		]) {
			expect(sql).toContain(eventName);
		}
	});
});
