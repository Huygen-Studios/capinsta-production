import { describe, expect, test } from "bun:test";
import { authenticatedFetchWithClient } from "./authenticated-fetch";

function auth({
	accessToken = "token-one",
	refreshedToken = "token-two",
	refreshError = null,
}: {
	accessToken?: string | null;
	refreshedToken?: string | null;
	refreshError?: unknown;
}) {
	let refreshes = 0;
	return {
		client: {
			getSession: async () => ({
				data: {
					session: accessToken ? { access_token: accessToken } : null,
				},
			}),
			refreshSession: async () => {
				refreshes += 1;
				return {
					data: {
						session: refreshedToken ? { access_token: refreshedToken } : null,
					},
					error: refreshError,
				};
			},
		},
		refreshCount: () => refreshes,
	};
}

describe("authenticatedFetchWithClient", () => {
	test("attaches the bearer token without changing FormData content type", async () => {
		const state = auth({});
		const form = new FormData();
		form.set("file", new File(["video"], "clip.mp4", { type: "video/mp4" }));
		await authenticatedFetchWithClient({
			input: "https://api.example/jobs",
			init: { method: "POST", body: form },
			auth: state.client,
			fetchImpl: async (_input, init) => {
				const headers = new Headers(init?.headers);
				expect(headers.get("authorization")).toBe("Bearer token-one");
				expect(headers.has("content-type")).toBe(false);
				expect(init?.body).toBe(form);
				return new Response("{}", { status: 201 });
			},
		});
	});

	test("refreshes an expired token once and preserves FormData", async () => {
		const state = auth({});
		const form = new FormData();
		let calls = 0;
		const response = await authenticatedFetchWithClient({
			input: "https://api.example/jobs",
			init: { method: "POST", body: form },
			auth: state.client,
			fetchImpl: async (_input, init) => {
				calls += 1;
				expect(init?.body).toBe(form);
				if (calls === 1) {
					return Response.json(
						{ detail: "Unauthorized", code: "token_expired" },
						{ status: 401 },
					);
				}
				expect(new Headers(init?.headers).get("authorization")).toBe(
					"Bearer token-two",
				);
				return Response.json({ ok: true });
			},
		});
		expect(response.ok).toBe(true);
		expect(calls).toBe(2);
		expect(state.refreshCount()).toBe(1);
	});

	test("does not retry non-expiry 401 responses", async () => {
		const state = auth({});
		let calls = 0;
		const response = await authenticatedFetchWithClient({
			input: "https://api.example/jobs",
			auth: state.client,
			fetchImpl: async () => {
				calls += 1;
				return Response.json(
					{ detail: "Unauthorized", code: "invalid_token" },
					{ status: 401 },
				);
			},
		});
		expect(response.status).toBe(401);
		expect(calls).toBe(1);
		expect(state.refreshCount()).toBe(0);
	});

	test("reports session expiry when refresh fails", async () => {
		const state = auth({
			refreshedToken: null,
			refreshError: new Error("failed"),
		});
		await expect(
			authenticatedFetchWithClient({
				input: "https://api.example/jobs",
				auth: state.client,
				fetchImpl: async () =>
					Response.json({ code: "token_expired" }, { status: 401 }),
			}),
		).rejects.toThrow("Your session expired. Please sign in again.");
		expect(state.refreshCount()).toBe(1);
	});
});
