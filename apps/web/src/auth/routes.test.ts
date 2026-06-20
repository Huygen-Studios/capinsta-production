import { describe, expect, test, mock } from "bun:test";
import {
	DEFAULT_AUTHENTICATED_PATH,
	isProtectedPath,
	isSafeInternalPath,
	signInPathFor,
} from "./routes";
import { GET, getTrustedPublicOrigin } from "../app/auth/callback/route";

mock.module("@/lib/supabase/server", () => {
	return {
		createClient: async () => {
			return {
				auth: {
					exchangeCodeForSession: async (code: string) => {
						if (code === "valid-code") {
							return { data: {}, error: null };
						}
						return { data: null, error: new Error("invalid code") };
					},
				},
			};
		},
	};
});

describe("authentication route policy", () => {
	test("protects projects and all editor routes", () => {
		expect(isProtectedPath("/projects")).toBe(true);
		expect(isProtectedPath("/projects/abc")).toBe(true);
		expect(isProtectedPath("/editor/project-1")).toBe(true);
		expect(isProtectedPath("/")).toBe(false);
		expect(isProtectedPath("/render")).toBe(false);
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
});

describe("auth callback GET handler and public origin resolution", () => {
	test("uses NEXT_PUBLIC_SITE_URL if configured and not internal", async () => {
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "https://capinsta.huygenstudios.com";
		try {
			const request = new Request("https://0.0.0.0:3000/auth/callback?code=valid-code&next=%2Fprojects");
			const origin = getTrustedPublicOrigin(request);
			expect(origin).toBe("https://capinsta.huygenstudios.com");

			const response = await GET(request);
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

			const response = await GET(request);
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
			const response = await GET(request);
			expect(response.status).toBe(307);
			expect(response.headers.get("Location")).toBe(
				"https://capinsta.huygenstudios.com/sign-in?error=callback&redirect=%2Fprojects"
			);
		} finally {
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});

	test("next param is restricted using isSafeInternalPath", async () => {
		const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;
		process.env.NEXT_PUBLIC_SITE_URL = "https://capinsta.huygenstudios.com";
		try {
			// Unsafe next redirect (external)
			const request = new Request("https://0.0.0.0:3000/auth/callback?code=valid-code&next=https://evil.example");
			const response = await GET(request);
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

			const response = await GET(request);
			expect(response.headers.get("Location")).toBe("http://localhost:3000/projects");
		} finally {
			process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
		}
	});
});

