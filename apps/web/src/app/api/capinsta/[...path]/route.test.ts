import { mock } from "bun:test";
/* eslint-disable @typescript-eslint/no-explicit-any, opencut/prefer-object-params -- Fetch/stream test doubles intentionally model the runtime boundary. */

mock.module("server-only", () => ({}));
mock.module("@/access/server", () => ({
	appPermissionForPath: () => "mock-permission",
	requireApiPermission: () => null,
	getCurrentAccessContext: () => ({ userId: "test-user" }),
}));
mock.module("@/auth/csrf", () => ({
	requireCsrfProtection: () => null,
}));
mock.module("@/capinsta/proxy-url", () => ({
	capinstaBackendUrl: () => "http://localhost:8000/api/jobs",
}));
mock.module("@/capinsta/proxy-http", () => ({
	buildProxyRequestHeaders: (headers: any) => headers,
	buildProxyResponseHeaders: (headers: any) => headers,
}));
mock.module("@/env/web", () => ({
	webEnv: { BACKEND_INTERNAL_URL: "http://localhost:8000" },
}));
mock.module("@/product-events/ledger", () => ({ recordProductEvent: () => Promise.resolve() }));

import { describe, expect, test, spyOn } from "bun:test";

describe("Capinsta proxy route handler", () => {
	test("does not call request.arrayBuffer() and streams body", async () => {
		const { POST } = await import("./route");
		const mockBody = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("test chunk"));
				controller.close();
			}
		});
		const request = new Request("http://localhost/api/capinsta/jobs", {
			method: "POST",
			body: mockBody,
			headers: {
				"content-type": "application/octet-stream"
			}
		});

		const arrayBufferSpy = spyOn(request, "arrayBuffer");

		const originalFetch = global.fetch;
		let fetchCallInit: any = null;
		global.fetch = async (url: any, init: any) => {
			fetchCallInit = init;
			return new Response("ok", { status: 200 });
		};

		try {
			const response = await POST(request, { params: Promise.resolve({ path: ["jobs"] }) });
			expect(response.status).toBe(200);
			expect(arrayBufferSpy).not.toHaveBeenCalled();
			expect(fetchCallInit).not.toBeNull();
			expect(fetchCallInit.body).toBe(mockBody);
			expect(fetchCallInit.duplex).toBe("half");
		} finally {
			global.fetch = originalFetch;
		}
	});
});
