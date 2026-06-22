import { describe, expect, test } from "bun:test";
import {
	buildProxyRequestHeaders,
	buildProxyResponseHeaders,
} from "./proxy-http";

describe("Capinsta proxy headers", () => {
	test("forwards authorization and the browser-generated multipart boundary", async () => {
		const formData = new FormData();
		formData.append(
			"file",
			new File(["video"], "हिन्दी filename with spaces.mp4", {
				type: "video/mp4",
			}),
		);
		const request = new Request("http://localhost/api/capinsta/api/jobs", {
			method: "POST",
			body: formData,
			headers: { authorization: "Bearer test-token" },
		});
		const contentType = request.headers.get("content-type");
		expect(contentType).toContain("multipart/form-data; boundary=");

		const headers = buildProxyRequestHeaders(
			new Headers({
				authorization: "Bearer test-token",
				"content-type": contentType!,
				cookie: "browser-session=private",
				"accept-encoding": "zstd, br, gzip",
			}),
		);

		expect(headers.get("authorization")).toBe("Bearer test-token");
		expect(headers.get("content-type")).toBe(contentType);
		expect(headers.get("accept-encoding")).toBe("identity");
		expect(headers.has("cookie")).toBe(false);
		expect(await request.text()).toContain("हिन्दी filename with spaces.mp4");
	});

	test("preserves upstream content type and encoding while removing stale lengths", () => {
		const headers = buildProxyResponseHeaders(
			new Headers({
				"content-type": "application/json",
				"content-encoding": "zstd",
				"content-length": "342",
				"transfer-encoding": "chunked",
			}),
		);

		expect(headers.get("content-type")).toBe("application/json");
		expect(headers.get("content-encoding")).toBe("zstd");
		expect(headers.has("content-length")).toBe(false);
		expect(headers.has("transfer-encoding")).toBe(false);
	});
});
