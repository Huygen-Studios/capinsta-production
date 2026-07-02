function stringValue(value: unknown) {
	return typeof value === "string" ? value : null;
}

export function sanitizeDonationText({
	value,
	maxLength,
}: {
	value: string | null | undefined;
	maxLength: number;
}) {
	const sanitized = (value ?? "")
		.split("")
		.map((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127 ? " " : character;
		})
		.join("")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
	return sanitized.length > 0 ? sanitized : null;
}

export function validateRazorpayAmount({
	amount,
	currency,
	expectedAmountPaise,
}: {
	amount: unknown;
	currency: unknown;
	expectedAmountPaise: number;
}) {
	if (typeof amount !== "number") return { valid: false, reason: "missing_amount" };
	if (amount !== expectedAmountPaise) return { valid: false, reason: "wrong_amount" };
	if (stringValue(currency)?.toUpperCase() !== "INR") {
		return { valid: false, reason: "wrong_currency" };
	}
	return { valid: true, reason: "ok" };
}
