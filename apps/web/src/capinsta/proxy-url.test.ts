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

	test("does not duplicate api when the internal backend base already includes it", () => {
		expect(
			capinstaBackendUrl({
				backendBaseUrl: "http://api:10000/api",
				path: ["api", "clipping", "media", "uploads"],
			}),
		).toBe("http://api:10000/api/clipping/media/uploads");
	});

	test("adds api when callers pass a route-group path", () => {
		expect(
			capinstaBackendUrl({
				backendBaseUrl: "http://api:10000",
				path: ["clipping", "workflows", "media-1", "advance"],
			}),
		).toBe("http://api:10000/api/clipping/workflows/media-1/advance");
	});

	test("keeps production route contracts stable", () => {
		for (const route of [
			"api/jobs",
			"api/jobs/job-1",
			"api/clipping/media/uploads",
			"api/clipping/media/uploads/upload-1/complete",
			"api/clipping/workflows/media-1/advance",
			"api/clipping/projects/project-1/candidates",
			"api/clipping/projects/project-1/exports",
			"api/capinsta/media/media-1/access",
		]) {
			expect(
				capinstaBackendUrl({
					backendBaseUrl: "http://api:10000/api",
					path: route.split("/"),
				}),
			).toBe(`http://api:10000/${route}`);
		}
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
