import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
describe("admin launch UI contracts", () => {
	test("refresh preserves URL-owned search, sort, and pagination state", () => {
		const modulePage = readFileSync(join(import.meta.dir, "../components/admin/admin-module-page.tsx"), "utf8");
		const refresh = readFileSync(join(import.meta.dir, "../components/admin/admin-refresh-controls.tsx"), "utf8");
		expect(modulePage).toContain('params.sort ?? "newest"');
		expect(modulePage).toContain("sort=${encodeURIComponent(sort)}");
		expect(refresh).toContain("router.refresh()");
		expect(refresh).toContain('document.visibilityState === "visible"');
	});
	test("recent activity is merged and newest-first", () => {
		const data = readFileSync(join(import.meta.dir, "data.ts"), "utf8");
		expect(data).toContain("activitySettled");
		expect(data).toContain("right.createdAt.getTime() - left.createdAt.getTime()");
	});
	test("security Manage uses the canonical route builder", () => {
		const modulePage = readFileSync(join(import.meta.dir, "../components/admin/admin-module-page.tsx"), "utf8");
		expect(modulePage).toContain("adminRoutes.userSecurity");
	});
});
