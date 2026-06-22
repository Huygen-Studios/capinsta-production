const HOP_BY_HOP_HEADERS = [
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
] as const;

function deleteHopByHopHeaders(headers: Headers) {
	for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
}

export function buildProxyRequestHeaders(requestHeaders: Headers): Headers {
	const headers = new Headers(requestHeaders);
	headers.delete("host");
	headers.delete("content-length");
	headers.delete("cookie");
	deleteHopByHopHeaders(headers);
	headers.set("accept-encoding", "identity");
	headers.set("x-capinsta-proxy", "nextjs");
	headers.set(
		"x-correlation-id",
		headers.get("x-correlation-id") ?? crypto.randomUUID(),
	);
	return headers;
}

export function buildProxyResponseHeaders(responseHeaders: Headers): Headers {
	const headers = new Headers(responseHeaders);
	headers.delete("content-length");
	deleteHopByHopHeaders(headers);
	return headers;
}
