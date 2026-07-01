export const PASSWORD_POLICY = {
	minLength: 15,
	maxLength: 128,
	supportedMaxLength: 64,
	tooShortMessage: "Use at least 15 characters for your password.",
	tooLongMessage: "Password must be 128 characters or fewer.",
} as const;

export function validatePasswordLength(password: string): string | null {
	if (password.length > PASSWORD_POLICY.maxLength) {
		return PASSWORD_POLICY.tooLongMessage;
	}
	if (password.length < PASSWORD_POLICY.minLength) {
		return PASSWORD_POLICY.tooShortMessage;
	}
	return null;
}
