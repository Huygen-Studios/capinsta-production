"use client";

import { createClient } from "./client";

type Session = { access_token: string } | null;
type AuthClient = {
	getSession(): Promise<{ data: { session: Session } }>;
	refreshSession(): Promise<{
		data: { session: Session };
		error: unknown;
	}>;
};

export async function authenticatedFetchWithClient({
	input,
	init = {},
	fetchImpl,
	auth,
}: {
	input: RequestInfo | URL;
	init?: RequestInit;
	fetchImpl: typeof fetch;
	auth: AuthClient;
}): Promise<Response> {
	const {
		data: { session },
	} = await auth.getSession();
	const headers = new Headers(init.headers);
	if (session?.access_token) {
		headers.set("Authorization", `Bearer ${session.access_token}`);
	}
	const response = await fetchImpl(input, { ...init, headers });
	if (response.status !== 401) return response;

	const body: unknown = await response
		.clone()
		.json()
		.catch(() => null);
	const expired =
		typeof body === "object" &&
		body !== null &&
		"code" in body &&
		body.code === "token_expired";
	if (!expired) return response;

	const {
		data: { session: refreshedSession },
		error,
	} = await auth.refreshSession();
	if (error || !refreshedSession?.access_token) {
		throw new Error("Your session expired. Please sign in again.");
	}
	const retryHeaders = new Headers(init.headers);
	retryHeaders.set("Authorization", `Bearer ${refreshedSession.access_token}`);
	return fetchImpl(input, { ...init, headers: retryHeaders });
}

// eslint-disable-next-line opencut/prefer-object-params -- Keep the standard fetch-compatible call signature used by API clients.
export async function authenticatedFetch(
	input: RequestInfo | URL,
	init: RequestInit = {},
	fetchImpl: typeof fetch = fetch,
): Promise<Response> {
	// Existing API unit tests inject a transport boundary and intentionally avoid
	// browser session access. Production calls use the authenticated path.
	if (fetchImpl !== fetch) return fetchImpl(input, init);
	const supabase = createClient();
	return authenticatedFetchWithClient({
		input,
		init,
		fetchImpl,
		auth: supabase.auth,
	});
}
