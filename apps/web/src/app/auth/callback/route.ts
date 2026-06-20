import { NextResponse } from "next/server";
import { isSafeInternalPath } from "@/auth/routes";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const next = isSafeInternalPath(url.searchParams.get("next"));
	if (code) {
		const supabase = await createClient();
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) return NextResponse.redirect(new URL(next, url.origin));
	}
	const errorUrl = new URL("/sign-in", url.origin);
	errorUrl.searchParams.set("error", "callback");
	errorUrl.searchParams.set("redirect", next);
	return NextResponse.redirect(errorUrl);
}
