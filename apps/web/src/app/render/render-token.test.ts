import { describe, expect, test } from "bun:test";
import { createRenderToken, validateRenderToken } from "./render-token";

const secret = "render-secret-with-at-least-32-bytes";

describe("render token validation", () => {
	test("rejects a missing render token", () => {
		expect(
			validateRenderToken({
				token: undefined,
				exportJobId: "job-1",
				secret,
				now: 100,
			}),
		).toEqual({ ok: false, reason: "missing render token" });
	});

	test("rejects an invalid render token", () => {
		expect(
			validateRenderToken({
				token: "not-a-valid-token",
				exportJobId: "job-1",
				secret,
				now: 100,
			}),
		).toEqual({ ok: false, reason: "invalid render token" });
	});

	test("rejects an expired render token", () => {
		const token = createRenderToken({
			exportJobId: "job-1",
			expiresAt: 100,
			secret,
		});

		expect(
			validateRenderToken({
				token,
				exportJobId: "job-1",
				secret,
				now: 100,
			}),
		).toEqual({ ok: false, reason: "expired render token" });
	});

	test("rejects a token for another export job", () => {
		const token = createRenderToken({
			exportJobId: "job-1",
			expiresAt: 200,
			secret,
		});

		expect(
			validateRenderToken({
				token,
				exportJobId: "job-2",
				secret,
				now: 100,
			}),
		).toEqual({ ok: false, reason: "render token is for another export job" });
	});

	test("accepts a valid render token without a user session", () => {
		const token = createRenderToken({
			exportJobId: "job-1",
			expiresAt: 200,
			secret,
		});

		expect(
			validateRenderToken({
				token,
				exportJobId: "job-1",
				secret,
				now: 100,
			}),
		).toMatchObject({
			ok: true,
			payload: {
				export_job_id: "job-1",
				exp: 200,
				aud: "capinsta.render",
			},
		});
	});
});
