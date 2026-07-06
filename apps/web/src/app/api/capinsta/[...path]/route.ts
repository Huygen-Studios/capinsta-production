import { NextResponse } from "next/server";
import { appPermissionForPath, requireApiPermission } from "@/access/server";
import { requireCsrfProtection } from "@/auth/csrf";
import { capinstaBackendUrl } from "@/capinsta/proxy-url";
import {
	buildProxyRequestHeaders,
	buildProxyResponseHeaders,
} from "@/capinsta/proxy-http";
import { webEnv } from "@/env/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Next.js route handlers require this positional signature.
// eslint-disable-next-line opencut/prefer-object-params
async function proxy(
	request: Request,
	{ params }: { params: Promise<{ path: string[] }> },
) {
	const csrf = requireCsrfProtection(request);
	if (csrf) return csrf;

	const { path } = await params;
	const requestPath = `/${path.join("/")}`;
	const denial = await requireApiPermission(
		appPermissionForPath(`/api/capinsta${requestPath}`),
		`/api/capinsta${requestPath}`,
	);
	if (denial) return denial;
	const incoming = new URL(request.url);
	const target = capinstaBackendUrl({
		backendBaseUrl: webEnv.BACKEND_INTERNAL_URL,
		path,
		search: incoming.search,
	});
	const headers = buildProxyRequestHeaders(request.headers);

	try {
		const init: RequestInit & { duplex?: "half" } = {
			method: request.method,
			headers,
			redirect: "manual",
			cache: "no-store",
			signal: request.signal,
		};
		if (METHODS_WITH_BODY.has(request.method) && request.body) {
			init.body = request.body;
			init.duplex = "half";
		}
		const response = await fetch(target, init);
		const responseHeaders = buildProxyResponseHeaders(response.headers);
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders,
		});
	} catch (error) {
		const correlationId = headers.get("x-correlation-id");
		console.error("capinsta_proxy_failed", {
			method: request.method,
			path: `/${path.join("/")}`,
			correlationId,
			category: error instanceof Error ? error.name : "unknown",
		});
		return NextResponse.json(
			{
				detail: "The Capinsta backend is temporarily unreachable.",
				code: "backend_unreachable",
				stage: "proxy_connection",
				correlationId,
			},
			{ status: 503 },
		);
	}
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
