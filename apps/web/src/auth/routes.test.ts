import { describe, expect, test } from "bun:test";
import {
	DEFAULT_AUTHENTICATED_PATH,
	isProtectedPath,
	isSafeInternalPath,
	signInPathFor,
} from "./routes";

describe("authentication route policy", () => {
	test("protects projects and all editor routes", () => {
		expect(isProtectedPath("/projects")).toBe(true);
		expect(isProtectedPath("/projects/abc")).toBe(true);
		expect(isProtectedPath("/editor/project-1")).toBe(true);
		expect(isProtectedPath("/")).toBe(false);
		expect(isProtectedPath("/render")).toBe(false);
	});

	test("preserves safe internal redirects", () => {
		expect(isSafeInternalPath("/editor/abc?tab=captions")).toBe(
			"/editor/abc?tab=captions",
		);
		expect(signInPathFor("/projects/abc")).toBe(
			"/sign-in?redirect=%2Fprojects%2Fabc",
		);
	});

	test("rejects external and protocol-relative redirects", () => {
		expect(isSafeInternalPath("https://evil.example")).toBe(
			DEFAULT_AUTHENTICATED_PATH,
		);
		expect(isSafeInternalPath("//evil.example/path")).toBe(
			DEFAULT_AUTHENTICATED_PATH,
		);
		expect(isSafeInternalPath("/\\evil.example")).toBe(
			DEFAULT_AUTHENTICATED_PATH,
		);
	});
});
