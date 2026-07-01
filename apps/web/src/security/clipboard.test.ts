import { describe, expect, test } from "bun:test";
import { sanitizeClipboardText } from "./clipboard";

describe("clipboard text sanitizer", () => {
	test("removes bidi and invisible controls while preserving normal whitespace", () => {
		const input = "safe\u202Ecod.exe\u200B\nnext\tline";

		expect(sanitizeClipboardText(input)).toBe("safecod.exe\nnext\tline");
	});

	test("removes unsafe ascii control characters", () => {
		expect(sanitizeClipboardText("hello\u0000\u0008world")).toBe("helloworld");
	});

	test("redacts bearer and jwt-like tokens", () => {
		const copied = sanitizeClipboardText(
			"Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456 token=eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.qrstuvwxyz123456",
		);

		expect(copied).toContain("Bearer [redacted-token]");
		expect(copied).toContain("token=[redacted]");
		expect(copied).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
	});

	test("redacts secret assignments and signed url parameters", () => {
		const copied = sanitizeClipboardText(
			"https://storage.example/file.mp4?X-Amz-Signature=abc123&Expires=999 password=hunter2 api_key=sk-live-secret",
		);

		expect(copied).toContain("X-Amz-Signature=[redacted]");
		expect(copied).toContain("Expires=[redacted]");
		expect(copied).toContain("password=[redacted]");
		expect(copied).toContain("api_key=[redacted]");
		expect(copied).not.toContain("hunter2");
		expect(copied).not.toContain("sk-live-secret");
	});
});
