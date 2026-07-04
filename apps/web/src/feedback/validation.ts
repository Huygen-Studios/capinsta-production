export const MIN_FEEDBACK_CHARACTERS = 10;
export const MAX_FEEDBACK_CHARACTERS = 2000;

export type FeedbackValidationResult =
	| { ok: true; trimmedLength: number; length: number }
	| { ok: false; message: string; trimmedLength: number; length: number };

export function validateFeedbackMessage(message: string): FeedbackValidationResult {
	const length = message.length;
	const trimmedLength = message.trim().length;
	if (trimmedLength < MIN_FEEDBACK_CHARACTERS) {
		return {
			ok: false,
			message: `Please enter at least ${MIN_FEEDBACK_CHARACTERS} characters.`,
			trimmedLength,
			length,
		};
	}
	if (length > MAX_FEEDBACK_CHARACTERS) {
		return {
			ok: false,
			message: `Feedback cannot exceed ${MAX_FEEDBACK_CHARACTERS.toLocaleString()} characters.`,
			trimmedLength,
			length,
		};
	}
	return { ok: true, trimmedLength, length };
}
