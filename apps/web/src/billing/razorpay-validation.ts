function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object") return {};
	return Object.fromEntries(Object.entries(value));
}

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

export function validatePrivateServerSubscriptionEntity({
	entity,
	expectedPlanId,
}: {
	entity: Record<string, unknown>;
	expectedPlanId?: string;
}) {
	const providerSubscriptionId = stringValue(entity.id);
	const providerPlanId = stringValue(entity.plan_id);
	const userId = stringValue(asRecord(entity.notes).capinsta_user_id);
	if (!providerSubscriptionId || !userId) {
		return { valid: false, reason: "missing_subscription_or_user" };
	}
	if (expectedPlanId && providerPlanId && providerPlanId !== expectedPlanId) {
		return { valid: false, reason: "wrong_plan" };
	}
	return { valid: true, reason: "ok" };
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
