import { NextResponse } from "next/server";
import { resolvePostAuthDestination } from "@/access/server";
import { authRequestId, logAuthFailure } from "@/auth/diagnostics";
import { isSafeInternalPath } from "@/auth/routes";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const next = isSafeInternalPath(url.searchParams.get("next"));
	const requestId = authRequestId(request);
	try {
		const supabase = await createClient();
		const {
			data: { user },
			error,
		} = await supabase.auth.getUser();
		if (error || !user) return NextResponse.redirect(new URL("/sign-in", url.origin));
		try {
			return NextResponse.redirect(
				new URL(await resolvePostAuthDestination(user.id, next), url.origin),
			);
		} catch (error) {
			logAuthFailure({
				request,
				requestId,
				category: "post_login_redirect_failed",
				code: "auth_resolve_destination_failed",
				provider: "supabase",
				userId: user.id,
				error,
			});
			return NextResponse.redirect(new URL("/access-pending", url.origin));
		}
	} catch (error) {
		logAuthFailure({
			request,
			requestId,
			category: "post_login_redirect_failed",
			code: "auth_resolve_failed",
			provider: "supabase",
			error,
		});
		return NextResponse.redirect(new URL("/sign-in?error=callback", url.origin));
	}
}
