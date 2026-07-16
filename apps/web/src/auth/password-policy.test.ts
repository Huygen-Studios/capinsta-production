import { describe, expect, test } from "bun:test";
import { readableAuthError, GENERIC_LOGIN_ERROR } from "./messages";
import { PASSWORD_POLICY, validatePassword } from "./password-policy";

describe("auth hardening policy", () => {
	test("maps login-related provider failures to one generic response", () => {
		for (const message of [
			"Invalid login credentials",
			"Invalid email or password",
			"User already registered",
		]) {
			expect(readableAuthError(new Error(message))).toBe(GENERIC_LOGIN_ERROR);
		}
	});

	test("shows a clear unverified-email message when Supabase exposes that state", () => {
		expect(readableAuthError(new Error("Email not confirmed"))).toBe(
			"Please verify your email before signing in.",
		);
	});

	test("requires six characters, a number, and a symbol", () => {
		expect(validatePassword("Ab1!")).toBe(PASSWORD_POLICY.tooShortMessage);
		expect(validatePassword("abcdef!")).toBe(PASSWORD_POLICY.missingNumberMessage);
		expect(validatePassword("abcdef1")).toBe(PASSWORD_POLICY.missingSymbolMessage);
		expect(validatePassword("abcd1!")).toBeNull();
	});

	test("enforces the hard maximum without truncation", () => {
		expect(validatePassword(`1!${"x".repeat(PASSWORD_POLICY.maxLength - 2)}`)).toBeNull();
		expect(validatePassword(`1!${"x".repeat(PASSWORD_POLICY.maxLength - 1)}`)).toBe(
			PASSWORD_POLICY.tooLongMessage,
		);
	});
});
