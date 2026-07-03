import { describe, expect, test } from "bun:test";
import { sanitizeSentryEvent } from "./sentry-sanitize";

describe("Sentry sanitization", () => {
	test("filters sensitive request and product fields", () => {
		const event = sanitizeSentryEvent({ event: {
			request: {
				headers: {
					authorization: "Bearer secret",
					cookie: "session=secret",
				},
				url: "https://capinsta.example/editor?token=secret",
			},
			extra: {
				captionText: "hello world",
				safeRoute: "/editor",
			},
		} });
		expect(event.request?.headers?.authorization).toBe("[Filtered]");
		expect(event.request?.headers?.cookie).toBe("[Filtered]");
		expect(event.request?.url).toBe("[Filtered]");
		expect((event.extra as Record<string, unknown>).captionText).toBe(
			"[Filtered]",
		);
		expect((event.extra as Record<string, unknown>).safeRoute).toBe("/editor");
	});
});
