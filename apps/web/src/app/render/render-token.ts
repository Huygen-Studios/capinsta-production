import { createHmac, timingSafeEqual } from "node:crypto";

export const RENDER_TOKEN_AUDIENCE = "capinsta.render";

export type RenderTokenPayload = {
	export_job_id: string;
	exp: number;
	aud: typeof RENDER_TOKEN_AUDIENCE;
};

export type RenderTokenValidation =
	| { ok: true; payload: RenderTokenPayload }
	| { ok: false; reason: string };

function base64UrlEncode(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string | null {
	try {
		return Buffer.from(value, "base64url").toString("utf8");
	} catch {
		return null;
	}
}

function signPayload(encodedPayload: string, secret: string): string {
	return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	return (
		leftBuffer.length === rightBuffer.length &&
		timingSafeEqual(leftBuffer, rightBuffer)
	);
}

export function createRenderToken({
	exportJobId,
	expiresAt,
	secret,
}: {
	exportJobId: string;
	expiresAt: number;
	secret: string;
}): string {
	const payload: RenderTokenPayload = {
		export_job_id: exportJobId,
		exp: expiresAt,
		aud: RENDER_TOKEN_AUDIENCE,
	};
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));
	return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

export function validateRenderToken({
	token,
	exportJobId,
	secret,
	now = Math.floor(Date.now() / 1000),
}: {
	token: string | undefined;
	exportJobId: string | undefined;
	secret: string | undefined;
	now?: number;
}): RenderTokenValidation {
	if (!secret) return { ok: false, reason: "render token secret is not configured" };
	if (!exportJobId) return { ok: false, reason: "missing export job id" };
	if (!token) return { ok: false, reason: "missing render token" };

	const parts = token.split(".");
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		return { ok: false, reason: "invalid render token" };
	}

	const [encodedPayload, signature] = parts;
	const expectedSignature = signPayload(encodedPayload, secret);
	if (!safeEqual(signature, expectedSignature)) {
		return { ok: false, reason: "invalid render token" };
	}

	const decoded = base64UrlDecode(encodedPayload);
	if (!decoded) return { ok: false, reason: "invalid render token" };

	let payload: Partial<RenderTokenPayload>;
	try {
		payload = JSON.parse(decoded) as Partial<RenderTokenPayload>;
	} catch {
		return { ok: false, reason: "invalid render token" };
	}

	if (payload.aud !== RENDER_TOKEN_AUDIENCE) {
		return { ok: false, reason: "wrong render token audience" };
	}
	if (payload.export_job_id !== exportJobId) {
		return { ok: false, reason: "render token is for another export job" };
	}
	if (typeof payload.exp !== "number" || payload.exp <= now) {
		return { ok: false, reason: "expired render token" };
	}

	return { ok: true, payload: payload as RenderTokenPayload };
}

export function firstSearchParam(
	value: string | string[] | undefined,
): string | undefined {
	if (Array.isArray(value)) return value[0];
	return value;
}
