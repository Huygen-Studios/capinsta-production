export const PASSWORD_POLICY = {
	minLength: 6,
	maxLength: 128,
	supportedMaxLength: 64,
	requirementsMessage: "Use at least 6 characters, including one number and one symbol.",
	tooShortMessage: "Password must be at least 6 characters.",
	missingNumberMessage: "Password must include at least one number.",
	missingSymbolMessage: "Password must include at least one symbol.",
	tooLongMessage: "Password must be 128 characters or fewer.",
} as const;

export function validatePassword(password: string): string | null {
	if (password.length > PASSWORD_POLICY.maxLength) {
		return PASSWORD_POLICY.tooLongMessage;
	}
	if (password.length < PASSWORD_POLICY.minLength) {
		return PASSWORD_POLICY.tooShortMessage;
	}
	if (!/\d/.test(password)) {
		return PASSWORD_POLICY.missingNumberMessage;
	}
	if (!/[^A-Za-z0-9\s]/.test(password)) {
		return PASSWORD_POLICY.missingSymbolMessage;
	}
	return null;
}
