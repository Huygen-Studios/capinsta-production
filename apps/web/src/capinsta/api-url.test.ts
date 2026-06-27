import { describe, expect, test } from "bun:test";
import { buildCapinstaApiUrl, buildCapinstaHealthUrl } from "./api-url";

describe("Capinsta API URL builder", () => {
	test("builds direct backend API URLs", () => {
		expect(
			buildCapinstaApiUrl({
				baseUrl: "https://api.example.com",
				path: "/jobs/job-1",
			}),
		).toBe("https://api.example.com/api/jobs/job-1");
		expect(
			buildCapinstaApiUrl({
				baseUrl: "https://api.example.com/",
				path: "jobs/job-1",
			}),
		).toBe("https://api.example.com/api/jobs/job-1");
	});

	test("builds same-origin proxy API URLs", () => {
		expect(
			buildCapinstaApiUrl({ baseUrl: "/api/capinsta", path: "/jobs/job-1" }),
		).toBe("/api/capinsta/api/jobs/job-1");
		expect(
			buildCapinstaApiUrl({
				baseUrl: "/api/capinsta/",
				path: "/api/jobs/job-1",
			}),
		).toBe("/api/capinsta/api/jobs/job-1");
	});

	test("does not duplicate api segments when base already ends with api", () => {
		expect(
			buildCapinstaApiUrl({
				baseUrl: "/api/capinsta/api",
				path: "/api/jobs/job-1",
			}),
		).toBe("/api/capinsta/api/jobs/job-1");
		expect(
			buildCapinstaApiUrl({
				baseUrl: "/api/capinsta",
				path: "/api/api/jobs/job-1",
			}),
		).toBe("/api/capinsta/api/jobs/job-1");
	});

	test("builds lightweight readiness URLs outside the backend API prefix", () => {
		expect(buildCapinstaHealthUrl({ baseUrl: "/api/capinsta" })).toBe(
			"/api/capinsta/health/ready",
		);
		expect(
			buildCapinstaHealthUrl({ baseUrl: "https://api.example.com/api" }),
		).toBe("https://api.example.com/api/health/ready");
	});
});
