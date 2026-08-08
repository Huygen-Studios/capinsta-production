import { describe, expect, test } from "bun:test";
import { sanitizeProductEventMetadata } from "./sanitize";

describe("product event metadata sanitization", () => {
	test("removes sensitive content before ledger storage", () => {
		const sanitized = sanitizeProductEventMetadata({
			metadata: {
				captionText: "raw caption",
				transcript: "full transcript",
				videoUrl: "https://signed.example/file.mp4?token=secret",
				email: "person@example.com",
				status: "completed",
				durationSeconds: 42,
			},
		});
		expect(sanitized).toEqual({
			status: "completed",
			durationSeconds: 42,
		});
	});
});
