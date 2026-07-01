import { describe, expect, test, mock } from "bun:test";
import {
	DEFAULT_AUTHENTICATED_PATH,
	isProtectedPath,
	isSafeInternalPath,
	signInPathFor,
	isUiTestAuthBypassEnabled,
} from "./routes";
import { getTrustedPublicOrigin } from "./trusted-origin";

let mockUser: { id: string; email?: string } | null = {
	id: "11111111-1111-4111-8111-111111111111",
	email: "user@example.com",
};
let mockExchangeError: Error | null = null;
let mockGetUserError: Error | null = null;
let mockProvisionError: Error | null = null;
let mockDestinationError: Error | null = null;

mock.module("@/access/server", () => {
	return {
		resolvePostAuthDestination: async (_userId: string, next: string) => {
			if (mockDestinationError) throw mockDestinationError;
			return next;
		},
	};
});

mock.module("@/auth/provisioning", () => {
	return {
		provisionAuthenticatedUser: async () => {
			if (mockProvisionError) throw mockProvisionError;
		},
	};
});

mock.module("@/lib/supabase/server", () => {
	return {
		createClient: async () => {
			return {
				auth: {
					exchangeCodeForSession: async (code: string) => {
						if (code === "valid-code" && !mockExchangeError) {
							return { data: {}, error: null };
						}
						return { data: null, error: mockExchangeError ?? new Error("invalid code") };
					},
					getUser: async () => ({
						data: { user: mockUser },
						error: mockGetUserError,
					}),
				},
			};
		},
	};
});

async function callbackGET(request: Request) {
	const route = await import("../app/auth/callback/route");
	return route.GET(request);
}

describe("authentication route policy", () => {
	test("protects projects and all editor routes", () => {
		expect(isProtectedPath("/projects")).toBe(true);
		expect(isProtectedPath("/projects/abc")).toBe(true);
		expect(isProtectedPath("/editor/project-1")).toBe(true);
		expect(isProtectedPath("/")).toBe(false);
		expect(isProtectedPath("/render")).toBe(true);
	});

	test("preserves safe internal redirects", () => {
		expect(isSafeInternalPath("/editor/abc?tab=captions")).toBe(
			"/editor/abc?tab=captions",
		);
		expect(signInPathFor("/projects/abc")).toBe(
			"/sign-in?redirect=%2Fprojects%2Fabc",
		);
	});

	test("rejects external and protocol-relative redirects", () => {
		expect(isSafeInternalPath("https://evil.example")).toBe(
			DEFAULT_AUTHENTICATED_PATH,
		);
		expect(isSafeInternalPath("//evil.example/path")).toBe(
			DEFAULT_AUTHENTICATED_PATH,
		);
		expect(isSafeInternalPath("/\\evil.example")).toBe(
			DEFAULT_AUTHENTICATED_PATH,
		);
	});

	test("UI test auth bypass can never activate in production", () => {
		expect(
			isUiTestAuthBypassEnabled({
				NODE_ENV: "production",
				CAPINSTA_UI_TEST_AUTH: "true",
			}),
		).toBe(false);
		expect(
			isUiTestAuthBypassEnabled({
				NODE_ENV: "development",
				CAPINSTA_UI_TEST_AUTH: "true",
			}),
		).toBe(true);
	});
});

describe("auth callback GET handler and public origin resolution", () => {
	test("existing Google user can complete callback and redirect", async () => {
		mockUser = {
			id: "11111111-1111-4111-8111-111111111111",
			email: "existing@example.com",
		};
		mockExchangeError = null;
		mockGetUserError = null;
		mockProvisionError = null;
		mockDestinationError = null;
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "https://capinsta.huygenstudios.com";
		try {
			const response = await callbackGET(
				new Request("https://capinsta.huygenstudios.com/auth/callback?code=valid-code&next=%2Fprojects"),
			);
			expect(response.status).toBe(307);
			expect(response.headers.get("Location")).toBe(
				"https://capinsta.huygenstudios.com/projects",
			);
		} finally {
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});

	test("uses NEXT_PUBLIC_SITE_URL if configured and not internal", async () => {
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "https://capinsta.huygenstudios.com";
		try {
			const request = new Request("https://0.0.0.0:3000/auth/callback?code=valid-code&next=%2Fprojects");
			const origin = getTrustedPublicOrigin(request);
			expect(origin).toBe("https://capinsta.huygenstudios.com");

			const response = await callbackGET(request);
			expect(response.status).toBe(307);
			expect(response.headers.get("Location")).toBe("https://capinsta.huygenstudios.com/projects");
		} finally {
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});

	test("uses x-forwarded-host and proto when NEXT_PUBLIC_SITE_URL is internal", async () => {
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000"; // internal, should be ignored
		try {
			const request = new Request("https://0.0.0.0:3000/auth/callback?code=valid-code&next=%2Fprojects", {
				headers: {
					"x-forwarded-host": "capinsta.huygenstudios.com",
					"x-forwarded-proto": "https",
				},
			});
			const origin = getTrustedPublicOrigin(request);
			expect(origin).toBe("https://capinsta.huygenstudios.com");

			const response = await callbackGET(request);
			expect(response.status).toBe(307);
			expect(response.headers.get("Location")).toBe("https://capinsta.huygenstudios.com/projects");
		} finally {
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});

	test("failed callback redirects to public /sign-in URL", async () => {
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "https://capinsta.huygenstudios.com";
		try {
			// No code param -> failure
			const request = new Request("https://0.0.0.0:3000/auth/callback?next=%2Fprojects");
			const response = await callbackGET(request);
			expect(response.status).toBe(307);
			const location = response.headers.get("Location");
			expect(location?.startsWith(
				"https://capinsta.huygenstudios.com/sign-in?error=callback&redirect=%2Fprojects&requestId=",
			)).toBe(true);
		} finally {
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});

	test("OAuth exchange failure is controlled and includes request id", async () => {
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "https://capinsta.huygenstudios.com";
		mockExchangeError = new Error("exchange failed");
		try {
			const response = await callbackGET(
				new Request("https://capinsta.huygenstudios.com/auth/callback?code=valid-code&next=%2Fprojects", {
					headers: { "x-request-id": "req-oauth-fail" },
				}),
			);
			expect(response.status).toBe(307);
			expect(response.headers.get("Location")).toBe(
				"https://capinsta.huygenstudios.com/sign-in?error=callback&redirect=%2Fprojects&requestId=req-oauth-fail",
			);
		} finally {
			mockExchangeError = null;
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});

	test("missing Google user after exchange is controlled", async () => {
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "https://capinsta.huygenstudios.com";
		mockUser = null;
		try {
			const response = await callbackGET(
				new Request("https://capinsta.huygenstudios.com/auth/callback?code=valid-code&next=%2Fprojects", {
					headers: { "x-request-id": "req-user-missing" },
				}),
			);
			expect(response.status).toBe(307);
			expect(response.headers.get("Location")).toBe(
				"https://capinsta.huygenstudios.com/sign-in?error=callback&redirect=%2Fprojects&requestId=req-user-missing",
			);
		} finally {
			mockUser = {
				id: "11111111-1111-4111-8111-111111111111",
				email: "user@example.com",
			};
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});

	test("provisioning failure returns controlled access-pending response", async () => {
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "https://capinsta.huygenstudios.com";
		mockProvisionError = new Error("profile insert failed");
		try {
			const response = await callbackGET(
				new Request("https://capinsta.huygenstudios.com/auth/callback?code=valid-code&next=%2Fprojects", {
					headers: { "x-request-id": "req-provisioning-fail" },
				}),
			);
			expect(response.status).toBe(307);
			expect(response.headers.get("Location")).toBe(
				"https://capinsta.huygenstudios.com/sign-in?error=access_pending&redirect=%2Fprojects&requestId=req-provisioning-fail",
			);
		} finally {
			mockProvisionError = null;
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});

	test("post-login access lookup failure redirects to controlled early access", async () => {
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "https://capinsta.huygenstudios.com";
		mockDestinationError = new Error("entitlement lookup failed");
		try {
			const response = await callbackGET(
				new Request("https://capinsta.huygenstudios.com/auth/callback?code=valid-code&next=%2Fprojects", {
					headers: { "x-request-id": "req-access-fail" },
				}),
			);
			expect(response.status).toBe(307);
			expect(response.headers.get("Location")).toBe(
				"https://capinsta.huygenstudios.com/early-access",
			);
		} finally {
			mockDestinationError = null;
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});

	test("next param is restricted using isSafeInternalPath", async () => {
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "https://capinsta.huygenstudios.com";
		try {
			// Unsafe next redirect (external)
			const request = new Request("https://0.0.0.0:3000/auth/callback?code=valid-code&next=https://evil.example");
			const response = await callbackGET(request);
			// Should fallback to default authenticated path (/projects)
			expect(response.headers.get("Location")).toBe("https://capinsta.huygenstudios.com/projects");
		} finally {
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});

	test("falls back to request.url origin when no public origin configured", async () => {
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000"; // internal
		try {
			const request = new Request("http://localhost:3000/auth/callback?code=valid-code&next=%2Fprojects");
			const origin = getTrustedPublicOrigin(request);
			expect(origin).toBe("http://localhost:3000");

			const response = await callbackGET(request);
			expect(response.headers.get("Location")).toBe("http://localhost:3000/projects");
		} finally {
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});
});
