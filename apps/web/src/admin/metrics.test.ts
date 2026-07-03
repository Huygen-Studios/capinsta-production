import { describe, expect, test } from "bun:test";
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
});
