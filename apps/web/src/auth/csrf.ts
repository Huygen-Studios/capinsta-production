/* eslint-disable opencut/prefer-object-params -- CSRF helpers mirror small internal request utilities. */
import { NextResponse } from "next/server";
import { getTrustedPublicOrigin } from "./trusted-origin";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TRUSTED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

export const CSRF_ORIGIN_MISMATCH_CODE = "CSRF_ORIGIN_MISMATCH";

type CsrfDecision =
	| { ok: true }
	| { ok: false; reason: "cross_site_fetch" | "origin_mismatch" };

function originFromUrl(value: string | null): string | null {
	if (!value) return null;
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

function allowedOriginsForRequest(
	request: Request,
	siteUrlEnv = process.env.NEXT_PUBLIC_SITE_URL,
) {
	const origins = new Set<string>();
	const trusted = getTrustedPublicOrigin(request, siteUrlEnv);
	if (trusted) origins.add(trusted);
	if (process.env.NODE_ENV !== "production") {
		const configured = originFromUrl(siteUrlEnv ?? null);
		if (configured) origins.add(configured);
	}

	try {
		origins.add(new URL(request.url).origin);
	} catch {
		// Invalid request URLs are not expected in route handlers; leave the set as-is.
	}

	return origins;
}

export function evaluateCsrfRequest(
	request: Request,
	siteUrlEnv = process.env.NEXT_PUBLIC_SITE_URL,
): CsrfDecision {
	if (SAFE_METHODS.has(request.method.toUpperCase())) return { ok: true };

	const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase() ?? null;
	if (fetchSite === "cross-site") {
		return { ok: false, reason: "cross_site_fetch" };
	}

	const allowedOrigins = allowedOriginsForRequest(request, siteUrlEnv);
	const origin = originFromUrl(request.headers.get("origin"));
	if (origin) {
		return allowedOrigins.has(origin)
			? { ok: true }
			: { ok: false, reason: "origin_mismatch" };
	}

	const refererOrigin = originFromUrl(request.headers.get("referer"));
	if (refererOrigin) {
		return allowedOrigins.has(refererOrigin)
			? { ok: true }
			: { ok: false, reason: "origin_mismatch" };
	}

	if (fetchSite && TRUSTED_FETCH_SITES.has(fetchSite)) return { ok: true };

	const hasCookie = Boolean(request.headers.get("cookie"));
	const hasAuthorization = Boolean(request.headers.get("authorization"));
	if (hasAuthorization && !hasCookie) return { ok: true };
	if (!hasCookie) return { ok: true };

	return { ok: false, reason: "origin_mismatch" };
}

export function requireCsrfProtection(request: Request): NextResponse | null {
	const decision = evaluateCsrfRequest(request);
	if (decision.ok) return null;

	return NextResponse.json(
		{
			error: {
				code: CSRF_ORIGIN_MISMATCH_CODE,
				message: "This request could not be verified.",
			},
		},
		{ status: 403 },
	);
}
