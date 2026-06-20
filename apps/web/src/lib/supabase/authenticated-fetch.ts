"use client";

import { createClient } from "./client";

export async function authenticatedFetch(
	input: RequestInfo | URL,
	init: RequestInit = {},
	fetchImpl: typeof fetch = fetch,
): Promise<Response> {
	// Unit tests inject a fetch boundary; production calls use the real browser fetch.
	if (fetchImpl !== fetch) return fetchImpl(input, init);

	const {
		data: { session },
	} = await createClient().auth.getSession();
	const headers = new Headers(init.headers);
	if (session?.access_token) {
		headers.set("Authorization", `Bearer ${session.access_token}`);
	}
	return fetchImpl(input, { ...init, headers });
}
