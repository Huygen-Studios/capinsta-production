import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/env/web", () => ({
	webEnv: {
		ADMIN_SECURITY_PEPPER: "test-pepper-that-is-long-enough-for-hmac",
		WHOP_APP_ID: "app_test",
	},
}));

describe("Whop OAuth state", () => {
	test("round-trips signed PKCE state and rejects tampering", async () => {
		const { createOAuthState, readOAuthState } = await import("./oauth");
		const state = createOAuthState("user_test");

		expect(readOAuthState(state.cookie)).toEqual(state.value);
		expect(readOAuthState(`${state.cookie}x`)).toBeNull();
		expect(state.value.verifier).not.toBe(state.value.state);
	});
});
