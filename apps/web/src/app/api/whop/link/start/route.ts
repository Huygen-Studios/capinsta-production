import { NextResponse } from "next/server";
import { getCurrentAccessContext } from "@/access/server";
import { webEnv } from "@/env/web";
import {
	authorizationUrl,
	createOAuthState,
	WHOP_OAUTH_COOKIE,
} from "@/whop/oauth";

export async function GET() {
	const context = await getCurrentAccessContext();
	if (!context) return NextResponse.redirect(new URL("/sign-in", webEnv.NEXT_PUBLIC_SITE_URL));
	if (webEnv.ENABLE_WHOP_ACCESS !== "true")
		return NextResponse.json({ code: "whop_disabled" }, { status: 503 });
	const redirectUri = new URL(
		"/api/whop/link/callback",
		webEnv.NEXT_PUBLIC_SITE_URL,
	).toString();
	const { value, cookie } = createOAuthState(context.userId);
	const response = NextResponse.redirect(authorizationUrl({ state: value, redirectUri }));
	response.cookies.set(WHOP_OAUTH_COOKIE, cookie, {
		httpOnly: true,
		secure: webEnv.NODE_ENV === "production",
		sameSite: "lax",
		path: "/api/whop/link",
		maxAge: 600,
	});
	return response;
}
