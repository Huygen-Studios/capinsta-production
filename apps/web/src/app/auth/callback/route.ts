import { NextResponse } from "next/server";
import { resolvePostAuthDestination } from "@/access/server";
import { authRequestId, logAuthFailure } from "@/auth/diagnostics";
import { provisionAuthenticatedUser } from "@/auth/provisioning";
import { isSafeInternalPath } from "@/auth/routes";
import { getTrustedPublicOrigin } from "@/auth/trusted-origin";
import { createClient } from "@/lib/supabase/server";

function signInErrorRedirect({
	publicOrigin,
	next,
	error,
	requestId,
}: {
	publicOrigin: string;
	next: string;
	error: string;
	requestId?: string;
}) {
	const errorUrl = new URL("/sign-in", publicOrigin);
	errorUrl.searchParams.set("error", error);
	errorUrl.searchParams.set("redirect", next);
	if (requestId) errorUrl.searchParams.set("requestId", requestId);
	return NextResponse.redirect(errorUrl);
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const next = isSafeInternalPath(url.searchParams.get("next"));
	const publicOrigin = getTrustedPublicOrigin(request);
	const requestId = authRequestId(request);

	if (code) {
		try {
			const supabase = await createClient();
			const { error } = await supabase.auth.exchangeCodeForSession(code);
			if (error) {
				logAuthFailure({
					request,
					requestId,
					category: "oauth_exchange_failed",
					code: "google_exchange_failed",
					provider: "google",
					error,
				});
				return signInErrorRedirect({ publicOrigin, next, error: "callback", requestId });
			}
			const {
				data: { user },
				error: userError,
			} = await supabase.auth.getUser();
			if (userError || !user) {
				logAuthFailure({
					request,
					requestId,
					category: "oauth_user_missing",
					code: "google_user_missing_after_exchange",
					provider: "google",
					error: userError,
				});
				return signInErrorRedirect({ publicOrigin, next, error: "callback", requestId });
			}
			try {
				await provisionAuthenticatedUser(user);
			} catch (error) {
				logAuthFailure({
					request,
					requestId,
					category: "provisioning_failed",
					code: "profile_provisioning_failed",
					provider: "google",
					userId: user.id,
					error,
				});
				return signInErrorRedirect({
					publicOrigin,
					next,
					error: "access_pending",
					requestId,
				});
			}
			let destination = "/";
			try {
				destination = await resolvePostAuthDestination(user.id, next);
			} catch (error) {
				logAuthFailure({
					request,
					requestId,
					category: "post_login_redirect_failed",
					code: "post_auth_destination_failed",
					provider: "google",
					userId: user.id,
					error,
				});
				destination = "/access-pending";
			}
			return NextResponse.redirect(new URL(destination, publicOrigin));
		} catch (error) {
			logAuthFailure({
				request,
				requestId,
				category: "post_login_redirect_failed",
				code: "google_callback_unhandled",
				provider: "google",
				error,
			});
			return signInErrorRedirect({ publicOrigin, next, error: "callback", requestId });
		}
	}
	return signInErrorRedirect({ publicOrigin, next, error: "callback", requestId });
}
