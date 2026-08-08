import { mock } from "bun:test";
mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
import { describe, expect, test } from "bun:test";
import type { User } from "@supabase/supabase-js";

function user({ id, createdAt }: { id: string; createdAt: string }): User {
	return { id, created_at: createdAt, app_metadata: {}, user_metadata: {}, aud: "authenticated" };
}

describe("Supabase Auth metrics adapter", () => {
	test("paginates every Auth page and uses inclusive start/exclusive end", async () => {
		const { collectAuthUserMetrics } = await import("./auth-metrics");
		const pages = [
			[user({ id: "a", createdAt: "2026-07-01T00:00:00.000Z" }), user({ id: "b", createdAt: "2026-07-01T12:00:00.000Z" })],
			[user({ id: "c", createdAt: "2026-07-02T00:00:00.000Z" })],
		];
		const calls: number[] = [];
		const result = await collectAuthUserMetrics({
			startUtc: "2026-07-01T00:00:00.000Z", endUtc: "2026-07-02T00:00:00.000Z", perPage: 2,
			listUsers: async ({ page }) => { calls.push(page); return { data: { users: pages[page - 1] ?? [] }, error: null }; },
		});
		expect(calls).toEqual([1, 2]);
		expect(result.total).toBe(3);
		expect(result.newInRange).toBe(2);
		expect(result.dailyNewUsers).toEqual([{ date: "2026-07-01", value: 2 }]);
	});

	test("a successful empty Auth source returns healthy zero data", async () => {
		const { collectAuthUserMetrics } = await import("./auth-metrics");
		const result = await collectAuthUserMetrics({ startUtc: "2026-07-01T00:00:00Z", endUtc: "2026-07-02T00:00:00Z", listUsers: async () => ({ data: { users: [] }, error: null }) });
		expect(result.total).toBe(0); expect(result.newInRange).toBe(0); expect(result.latestUsers).toEqual([]);
	});
});
