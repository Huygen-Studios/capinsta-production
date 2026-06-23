import { NextResponse } from "next/server";
import { resolvePostAuthDestination } from "@/access/server";
import { isSafeInternalPath } from "@/auth/routes";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const next = isSafeInternalPath(url.searchParams.get("next"));
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return NextResponse.redirect(new URL("/sign-in", url.origin));
	return NextResponse.redirect(
		new URL(await resolvePostAuthDestination(user.id, next), url.origin),
	);
}
