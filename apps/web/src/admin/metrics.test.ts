import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	getAdminMetricsRange,
	normalizeAdminMetricsRangePreset,
	resolveAdminMetric,
} from "./metrics-shared";

describe("admin metrics helpers", () => {
	test("normalizes unsupported ranges to rolling 7 days", () => {
		expect(normalizeAdminMetricsRangePreset({ value: "previous-week" })).toBe("7d");
		expect(normalizeAdminMetricsRangePreset({ value: "24h" })).toBe("24h");
	});

	test("uses UTC rolling inclusive-start exclusive-end ranges", () => {
		const range = getAdminMetricsRange({
			preset: "7d",
			now: new Date("2026-07-03T12:00:00.000Z"),
		});
		expect(range.startUtc).toBe("2026-06-26T12:00:00.000Z");
		expect(range.endUtc).toBe("2026-07-03T12:00:00.000Z");
		expect(range.timezone).toBe("UTC");
		expect(range.label).toContain("7 x 24");
	});

	test("failed metric query returns unavailable instead of zero", async () => {
		const result = await resolveAdminMetric({
			name: "newAccounts",
			source: "auth.users",
			definition: "test definition",
			now: new Date("2026-07-03T12:00:00.000Z"),
			query: async () => {
				throw new Error("database unavailable");
			},
		});
		expect(result.metric.status).toBe("unavailable");
		expect(result.metric.value).toBeNull();
		expect(result.error).toEqual({ metric: "newAccounts", code: "query_failed" });
	});

	test("no matching rows returns zero with ok status", async () => {
		const result = await resolveAdminMetric({ name: "empty", source: "test", definition: "empty source", query: async () => null });
		expect(result.metric.status).toBe("ok");
		expect(result.metric.value).toBe(0);
	});

	test("failed source includes a safe classified diagnostic", async () => {
		const result = await resolveAdminMetric({ name: "visitors", source: "PostHog", definition: "test", query: async () => { throw new Error("posthog_not_configured"); } });
		expect(result.metric.errorCode).toBe("missing_configuration");
		expect(result.metric.adminMessage).not.toContain("secret");
		expect(result.metric.retryable).toBe(false);
	});

	test("failed job metrics use terminal timestamps, not creation timestamps", () => {
		const source = readFileSync(join(import.meta.dir, "metrics.ts"), "utf8");
		expect(source).toContain('name: "captionJobsFailed"');
		expect(source).toContain('source: "caption_jobs.completed_at/status"');
		expect(source).toContain("and completed_at >= ${start}");
		expect(source).toContain('name: "exportsFailed"');
		expect(source).toContain('source: "export_jobs.completed_at/status"');
		expect(source).toContain("and completed_at >= started_at");
		expect(source).toContain("Promise.allSettled");
	});
});
