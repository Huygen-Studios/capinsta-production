import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath, signInPathFor } from "@/auth/routes";

export async function updateSession(request: NextRequest) {
	let response = NextResponse.next({ request });
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

	if (!url || !key) return response;

	const supabase = createServerClient(url, key, {
		cookies: {
			getAll: () => request.cookies.getAll(),
			setAll: (cookiesToSet) => {
				cookiesToSet.forEach(({ name, value }) =>
					request.cookies.set(name, value),
				);
				response = NextResponse.next({ request });
				cookiesToSet.forEach(({ name, value, options }) =>
					response.cookies.set(name, value, options),
				);
			},
		},
	});

	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user && isProtectedPath(request.nextUrl.pathname)) {
		const redirectUrl = request.nextUrl.clone();
		redirectUrl.pathname = "/sign-in";
		redirectUrl.search = new URL(
			signInPathFor(request.nextUrl.pathname, request.nextUrl.search),
			request.url,
		).search;
		return NextResponse.redirect(redirectUrl);
	}

	return response;
}
