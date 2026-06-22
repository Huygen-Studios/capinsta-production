import { describe, expect, test } from "bun:test";
import { readJsonApiResponse } from "./api-response";

function response({ body, init }: { body: BodyInit; init?: ResponseInit }) {
	return new Response(body, {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

describe("readJsonApiResponse", () => {
	test("reads valid JSON responses unchanged", async () => {
		await expect(
			readJsonApiResponse<{ job_id: string }>({
				response: response({ body: '{"job_id":"job-1"}' }),
				endpoint: "/api/capinsta/api/jobs",
			}),
		).resolves.toEqual({ job_id: "job-1" });
	});

	test("preserves JSON backend errors for the caller", async () => {
		await expect(
			readJsonApiResponse<{ detail: string }>({
				response: response({
					body: '{"detail":"Unauthorized"}',
					init: { status: 401 },
				}),
				endpoint: "/api/capinsta/api/jobs",
			}),
		).resolves.toEqual({ detail: "Unauthorized" });
	});

	test("describes HTML instead of parsing it as JSON", async () => {
		await expect(
			readJsonApiResponse({
				response: response({
					body: "<html>upstream failed</html>",
					init: {
						status: 502,
						headers: {
							"content-type": "text/html",
							"x-correlation-id": "corr-html",
						},
					},
				}),
				endpoint: "/api/capinsta/api/jobs",
			}),
		).rejects.toThrow(
			"Capinsta returned a non-JSON response. | endpoint=/api/capinsta/api/jobs | status=502 | content-type=text/html | correlation=corr-html | response-preview=<html>upstream failed</html>",
		);
	});

	test("does not decode binary responses as text", async () => {
		await expect(
			readJsonApiResponse({
				response: response({
					body: new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]),
					init: {
						headers: { "content-type": "application/octet-stream" },
					},
				}),
				endpoint: "/api/capinsta/api/jobs",
			}),
		).rejects.toThrow("response-preview=[binary bytes: 28 b5 2f fd]");
	});

	test("reports compressed/non-UTF-8 JSON bytes without Unexpected token", async () => {
		await expect(
			readJsonApiResponse({
				response: response({
					body: new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]),
					init: {
						headers: {
							"content-type": "application/json",
							"x-correlation-id": "corr-zstd",
						},
					},
				}),
				endpoint: "/api/capinsta/api/jobs",
			}),
		).rejects.toThrow(
			"Capinsta returned JSON with invalid UTF-8 bytes. | endpoint=/api/capinsta/api/jobs | status=200 | content-type=application/json | correlation=corr-zstd | response-preview=[non-UTF-8 bytes: 28 b5 2f fd]",
		);
	});

	test("reports malformed UTF-8 JSON with a safe text preview", async () => {
		await expect(
			readJsonApiResponse({
				response: response({ body: '{"job_id":' }),
				endpoint: "/api/capinsta/api/jobs",
			}),
		).rejects.toThrow(
			"Capinsta returned malformed JSON. | endpoint=/api/capinsta/api/jobs | status=200 | content-type=application/json",
		);
	});
});
