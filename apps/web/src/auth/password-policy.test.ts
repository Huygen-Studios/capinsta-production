import { describe, expect, test } from "bun:test";
import { readableAuthError, GENERIC_LOGIN_ERROR } from "./messages";
import { PASSWORD_POLICY, validatePasswordLength } from "./password-policy";

describe("auth hardening policy", () => {
	test("maps login-related provider failures to one generic response", () => {
		for (const message of [
			"Invalid login credentials",
			"Invalid email or password",
			"Email not confirmed",
			"User already registered",
		]) {
			expect(readableAuthError(new Error(message))).toBe(GENERIC_LOGIN_ERROR);
		}
	});

	test("enforces new password minimum and hard maximum without truncation", () => {
		expect(validatePasswordLength("short")).toBe(PASSWORD_POLICY.tooShortMessage);
		expect(validatePasswordLength("x".repeat(PASSWORD_POLICY.maxLength + 1))).toBe(PASSWORD_POLICY.tooLongMessage);
		expect(validatePasswordLength("x".repeat(PASSWORD_POLICY.minLength))).toBeNull();
	});
});
