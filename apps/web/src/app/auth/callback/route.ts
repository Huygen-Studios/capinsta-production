import { NextResponse } from "next/server";
import { resolvePostAuthDestination } from "@/access/server";
import { isSafeInternalPath } from "@/auth/routes";
import { getTrustedPublicOrigin } from "@/auth/trusted-origin";
import { createClient } from "@/lib/supabase/server";

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
