import { describe, expect, test } from "bun:test";
import { formatExportApiError } from "./index";

describe("formatExportApiError", () => {
	test("surfaces backend stage, status, endpoint, job, and correlation details", () => {
		const message = formatExportApiError({
			endpoint: "/api/capinsta/api/export/jobs/export-1",
			status: 200,
			payload: { stage: "playwright", error: "Browser process exited." },
			jobId: "export-1",
			correlationId: "corr-1",
		});

		expect(message).toContain(
			"Endpoint: /api/capinsta/api/export/jobs/export-1",
		);
		expect(message).toContain("HTTP status: 200");
		expect(message).toContain("Backend stage: playwright");
		expect(message).toContain("Backend error: Browser process exited.");
		expect(message).toContain("Export job ID: export-1");
		expect(message).toContain("Correlation ID: corr-1");
	});

	test("does not collapse a proxy connection failure to Failed to fetch", () => {
		const message = formatExportApiError({
			endpoint: "/api/capinsta/api/export/jobs",
			status: 503,
			payload: {
				stage: "proxy_connection",
				detail: "The Capinsta backend is temporarily unreachable.",
			},
			correlationId: "corr-2",
		});

		expect(message).not.toBe("Failed to fetch");
		expect(message).toContain("HTTP status: 503");
		expect(message).toContain("Backend stage: proxy_connection");
	});
});
