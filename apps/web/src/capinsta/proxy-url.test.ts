import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCapinstaApiBaseUrl } from "./featureFlags";
import { capinstaBackendUrl } from "./proxy-url";

describe("Capinsta API routing", () => {
	test("uses the same-origin proxy in local and production browser bundles", () => {
		expect(getCapinstaApiBaseUrl()).toBe("/api/capinsta");
	});

	test("maps the proxy path to the backend API without route drift", () => {
		expect(
			capinstaBackendUrl({
				backendBaseUrl: "http://backend:10000/",
				path: ["api", "export", "jobs"],
				search: "?page=1",
			}),
		).toBe("http://backend:10000/api/export/jobs?page=1");
	});

	test("the current editor does not call the legacy synchronous export route", () => {
		const rendererManager = readFileSync(
			join(import.meta.dir, "../core/managers/renderer-manager.ts"),
			"utf8",
		);

		expect(rendererManager).toContain("buildCapinstaApiUrl({");
		expect(rendererManager).toContain('path: "/export/jobs"');
		expect(rendererManager).not.toMatch(/\/api\/jobs\/.*\/export/);
		expect(rendererManager).not.toContain("http://localhost:8000");
	});
});
