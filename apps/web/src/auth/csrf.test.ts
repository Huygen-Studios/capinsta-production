import { describe, expect, test } from "bun:test";
import {
	CSRF_ORIGIN_MISMATCH_CODE,
	evaluateCsrfRequest,
	requireCsrfProtection,
} from "./csrf";

function postRequest(headers: HeadersInit = {}) {
	return new Request("https://capinsta.example/api/admin/mutations", {
		method: "POST",
		headers,
	});
}

describe("CSRF origin protection", () => {
	test("allows same-origin state-changing requests", () => {
		const decision = evaluateCsrfRequest(
			postRequest({
				origin: "https://capinsta.example",
				cookie: "sb-access-token=present",
			}),
		);

		expect(decision).toEqual({ ok: true });
	});

	test("allows configured public origin when the route receives an internal URL", () => {
		const request = new Request("http://0.0.0.0:3000/api/admin/mutations", {
			method: "POST",
			headers: {
				origin: "https://capinsta.example",
				cookie: "sb-access-token=present",
			},
		});

		const decision = evaluateCsrfRequest(
			request,
			"https://capinsta.example",
		);

		expect(decision).toEqual({ ok: true });
	});

	test("rejects cross-site fetch metadata before body parsing", () => {
		const response = requireCsrfProtection(
			postRequest({
				"sec-fetch-site": "cross-site",
				cookie: "sb-access-token=present",
			}),
		);

		expect(response?.status).toBe(403);
	});

	test("rejects mismatched origins", () => {
		const decision = evaluateCsrfRequest(
			postRequest({
				origin: "https://attacker.example",
				cookie: "sb-access-token=present",
			}),
		);

		expect(decision).toEqual({ ok: false, reason: "origin_mismatch" });
	});

	test("rejects cookie-authenticated unsafe requests without origin evidence", () => {
		const decision = evaluateCsrfRequest(
			postRequest({ cookie: "sb-access-token=present" }),
		);

		expect(decision).toEqual({ ok: false, reason: "origin_mismatch" });
	});

	test("allows non-cookie bearer API clients without browser origin headers", () => {
		const decision = evaluateCsrfRequest(
			postRequest({ authorization: "Bearer token" }),
		);

		expect(decision).toEqual({ ok: true });
	});

	test("returns the stable CSRF error code", async () => {
		const response = requireCsrfProtection(
			postRequest({
				origin: "https://attacker.example",
				cookie: "sb-access-token=present",
			}),
		);
		const body = await response?.json();

		expect(body?.error?.code).toBe(CSRF_ORIGIN_MISMATCH_CODE);
	});
});
