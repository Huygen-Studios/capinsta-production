import { NextResponse } from "next/server";
import { appPermissionForPath, getCurrentAccessContext, requireApiPermission } from "@/access/server";
import { requireCsrfProtection } from "@/auth/csrf";
import { capinstaBackendUrl } from "@/capinsta/proxy-url";
import {
	buildProxyRequestHeaders,
	buildProxyResponseHeaders,
} from "@/capinsta/proxy-http";
import { webEnv } from "@/env/web";
import { recordProductEvent, type ProductEventName } from "@/product-events/ledger";

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
		await recordOperationalEvent({ request, requestPath, response, correlationId: headers.get("x-correlation-id") ?? crypto.randomUUID() }).catch((error) => console.error("product_event_record_failed", { requestPath, errorName: error instanceof Error ? error.name : "unknown" }));
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

async function recordOperationalEvent({ request, requestPath, response, correlationId }: { request: Request; requestPath: string; response: Response; correlationId: string }) {
	if (!METHODS_WITH_BODY.has(request.method)) return;
	const failed = !response.ok;
	let eventName: ProductEventName | null = null;
	if (requestPath.includes("/projects") && request.method === "POST") eventName = "project_created";
	else if (requestPath.includes("/media")) eventName = failed ? "media_upload_failed" : "media_upload_completed";
	else if (requestPath.includes("/export")) eventName = failed ? "export_failed" : "export_started";
	else if (requestPath.includes("/captions") || requestPath.includes("/jobs")) eventName = failed ? "caption_job_failed" : "caption_job_started";
	if (!eventName) return;
	const context = await getCurrentAccessContext();
	await recordProductEvent({ eventName, eventKey: `${eventName}:${correlationId}`, userId: context?.userId, metadata: { status: response.status, adapter: "capinsta_proxy" } });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
