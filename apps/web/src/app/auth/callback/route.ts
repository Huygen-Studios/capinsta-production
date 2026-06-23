import { NextResponse } from "next/server";
import { resolvePostAuthDestination } from "@/access/server";
import { isSafeInternalPath } from "@/auth/routes";
import { createClient } from "@/lib/supabase/server";

// eslint-disable-next-line opencut/prefer-object-params
export function getTrustedPublicOrigin(
	request: Request,
	siteUrlEnv = process.env.NEXT_PUBLIC_SITE_URL,
): string {
	const isInternalHost = (host: string) => {
		const lower = host.toLowerCase().split(":")[0];
		return (
			lower === "localhost" ||
			lower === "0.0.0.0" ||
			lower === "127.0.0.1"
		);
	};

	const getOriginFromUrl = (urlStr: string | null | undefined): string | null => {
		if (!urlStr) return null;
		try {
			const parsed = new URL(urlStr);
			if (isInternalHost(parsed.hostname)) return null;
			return parsed.origin;
		} catch {
			return null;
		}
	};

	// 1. NEXT_PUBLIC_SITE_URL
	const siteUrlOrigin = getOriginFromUrl(siteUrlEnv);
	if (siteUrlOrigin) {
		return siteUrlOrigin;
	}

	// 2. x-forwarded-host + x-forwarded-proto
	const forwardedHost = request.headers.get("x-forwarded-host");
	const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
	if (forwardedHost) {
		const forwardedUrl = `${forwardedProto}://${forwardedHost}`;
		const forwardedOrigin = getOriginFromUrl(forwardedUrl);
		if (forwardedOrigin) {
			return forwardedOrigin;
		}
	}

	// 3. request.url origin only as fallback
	try {
		const requestUrl = new URL(request.url);
		return requestUrl.origin;
	} catch {
		return "http://localhost:3000";
	}
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const next = isSafeInternalPath(url.searchParams.get("next"));
	const publicOrigin = getTrustedPublicOrigin(request);

	if (code) {
		const supabase = await createClient();
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			const {
				data: { user },
			} = await supabase.auth.getUser();
			const destination = user
				? await resolvePostAuthDestination(user.id, next)
				: next;
			return NextResponse.redirect(new URL(destination, publicOrigin));
		}
	}
	const errorUrl = new URL("/sign-in", publicOrigin);
	errorUrl.searchParams.set("error", "callback");
	errorUrl.searchParams.set("redirect", next);
	return NextResponse.redirect(errorUrl);
}
