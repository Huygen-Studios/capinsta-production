import { describe, expect, test } from "bun:test";
import { findExpiredLocalProjectIds } from "./expiredProjectReconciliation";

const projects = [
	{
		metadata: { id: "local-active", updatedAt: new Date("2026-06-19T10:00:00Z") },
		capinstaServerJobId: "job-active",
	},
	{
		metadata: { id: "local-expired", updatedAt: new Date("2026-06-19T10:00:00Z") },
		capinstaServerJobId: "job-expired",
	},
	{
		metadata: { id: "local-only", updatedAt: new Date("2026-06-19T10:20:00Z") },
	},
];

describe("expired local project reconciliation", () => {
	test("removes only projects confirmed expired by the backend", async () => {
		const expired = await findExpiredLocalProjectIds({
			projects,
			baseUrl: "http://127.0.0.1:8000",
			now: Date.parse("2026-06-19T10:30:00Z"),
			fetchImpl: async (url) => {
				if (String(url).endsWith("job-expired")) {
					return new Response(
						JSON.stringify({ detail: "This project expired after 15 minutes" }),
						{ status: 410, headers: { "content-type": "application/json" } },
					);
				}
				return new Response(
					JSON.stringify({ job_id: "job-active", status: "completed", progress: 100 }),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		});

		expect(expired).toEqual(["local-expired"]);
	});

	test("keeps local projects when the backend is unreachable", async () => {
		const expired = await findExpiredLocalProjectIds({
			projects,
			baseUrl: "http://127.0.0.1:8000",
			now: Date.parse("2026-06-19T10:30:00Z"),
			fetchImpl: async () => {
				throw new TypeError("network unavailable");
			},
		});

		expect(expired).toEqual([]);
	});

	test("expires legacy local-only projects after 15 minutes", async () => {
		const expired = await findExpiredLocalProjectIds({
			projects: [projects[2]!],
			baseUrl: "http://127.0.0.1:8000",
			now: Date.parse("2026-06-19T10:36:00Z"),
		});

		expect(expired).toEqual(["local-only"]);
	});

	test("expires an explicitly exited local project after 15 minutes", async () => {
		const expired = await findExpiredLocalProjectIds({
			projects: [
				{
					metadata: { id: "exited", updatedAt: new Date("2026-06-19T10:00:00Z") },
					capinstaLeftAt: "2026-06-19T10:10:00Z",
				},
			],
			baseUrl: "http://127.0.0.1:8000",
			now: Date.parse("2026-06-19T10:25:01Z"),
		});

		expect(expired).toEqual(["exited"]);
	});
});
