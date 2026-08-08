export type AuthDiagnosticCategory =
	| "oauth_exchange_failed"
	| "oauth_user_missing"
	| "provisioning_failed"
	| "post_login_redirect_failed";

export function authRequestId(request: Request) {
	return (
		request.headers.get("x-request-id") ||
		request.headers.get("x-correlation-id") ||
		crypto.randomUUID()
	);
}

export function logAuthFailure({
	request,
	requestId,
	category,
	code,
	provider,
	userId,
	error,
}: {
	request: Request;
	requestId: string;
	category: AuthDiagnosticCategory;
	code: string;
	provider: string;
	userId?: string | null;
	error?: unknown;
}) {
	const url = new URL(request.url);
	const payload = {
		event: "auth_callback_failed",
		requestId,
		category,
		code,
		provider,
		route: url.pathname,
		userId: userId ?? null,
		errorName: error instanceof Error ? error.name : null,
		errorMessage: error instanceof Error ? error.message.slice(0, 180) : null,
	};
	console.error(JSON.stringify(payload));
}
