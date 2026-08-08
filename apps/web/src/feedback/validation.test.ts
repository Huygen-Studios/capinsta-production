import { describe, expect, test } from "bun:test";
import {
	MAX_FEEDBACK_CHARACTERS,
	MIN_FEEDBACK_CHARACTERS,
	validateFeedbackMessage,
} from "./validation";

describe("feedback validation", () => {
	test("rejects empty feedback", () => {
		const result = validateFeedbackMessage("");
		expect(result.ok).toBe(false);
		expect(result.message).toBe(
			`Please enter at least ${MIN_FEEDBACK_CHARACTERS} characters.`,
		);
	});

	test("rejects whitespace-only feedback", () => {
		expect(validateFeedbackMessage("          ").ok).toBe(false);
	});

	test("rejects 9 meaningful characters", () => {
		expect(validateFeedbackMessage("123456789").ok).toBe(false);
	});

	test("accepts exactly 10 meaningful characters", () => {
		expect(validateFeedbackMessage("1234567890").ok).toBe(true);
	});

	test("accepts exactly 2,000 characters", () => {
		expect(validateFeedbackMessage("a".repeat(MAX_FEEDBACK_CHARACTERS)).ok).toBe(
			true,
		);
	});

	test("rejects 2,001 characters", () => {
		const result = validateFeedbackMessage(
			"a".repeat(MAX_FEEDBACK_CHARACTERS + 1),
		);
		expect(result.ok).toBe(false);
		expect(result.message).toBe("Feedback cannot exceed 2,000 characters.");
	});
});
