import "server-only";

import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { webEnv } from "@/env/web";

export const WHOP_OAUTH_COOKIE = "capinsta_whop_oauth";

export type WhopOAuthState = {
	userId: string;
	state: string;
	verifier: string;
	expiresAt: number;
};

const b64 = (value: Buffer | string) =>
	Buffer.from(value).toString("base64url");

function signature(value: string) {
	return createHmac("sha256", webEnv.ADMIN_SECURITY_PEPPER)
		.update(value)
		.digest("base64url");
}

export function createOAuthState(userId: string) {
	const value: WhopOAuthState = {
		userId,
		state: b64(randomBytes(18)),
		verifier: b64(randomBytes(32)),
		expiresAt: Date.now() + 10 * 60_000,
	};
	const encoded = b64(JSON.stringify(value));
	return {
		value,
		cookie: `${encoded}.${signature(encoded)}`,
	};
}

export function readOAuthState(
	cookie: string | undefined,
): WhopOAuthState | null {
	const [encoded, supplied] = cookie?.split(".") ?? [];
	if (!encoded || !supplied) return null;
	const expected = signature(encoded);
	if (
		expected.length !== supplied.length ||
		!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
	)
		return null;
	try {
		const value: unknown = JSON.parse(
			Buffer.from(encoded, "base64url").toString(),
		);
		if (!value || typeof value !== "object") return null;
		const userId = Reflect.get(value, "userId");
		const state = Reflect.get(value, "state");
		const verifier = Reflect.get(value, "verifier");
		const expiresAt = Reflect.get(value, "expiresAt");
		return typeof userId === "string" &&
			typeof state === "string" &&
			typeof verifier === "string" &&
			typeof expiresAt === "number" &&
			expiresAt > Date.now()
			? { userId, state, verifier, expiresAt }
			: null;
	} catch {
		return null;
	}
}

export function authorizationUrl({
	state,
	redirectUri,
}: {
	state: WhopOAuthState;
	redirectUri: string;
}) {
	if (!webEnv.WHOP_APP_ID) throw new Error("whop_not_configured");
	const params = new URLSearchParams({
		response_type: "code",
		client_id: webEnv.WHOP_APP_ID,
		redirect_uri: redirectUri,
		scope: "openid profile",
		state: state.state,
		code_challenge: createHash("sha256")
			.update(state.verifier)
			.digest("base64url"),
		code_challenge_method: "S256",
	});
	return `https://api.whop.com/oauth/authorize?${params}`;
}
