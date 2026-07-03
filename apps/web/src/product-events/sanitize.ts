const SENSITIVE_METADATA_KEYS = [
	"authorization",
	"caption",
	"captions",
	"cookie",
	"email",
	"filename",
	"fileName",
	"mediaUrl",
	"message",
	"password",
	"payment",
	"razorpay",
	"signedUrl",
	"token",
	"transcript",
	"url",
] as const;

function isSensitiveKey(key: string) {
	const normalized = key.toLowerCase();
	return SENSITIVE_METADATA_KEYS.some((sensitive) =>
		normalized.includes(sensitive.toLowerCase()),
	);
}

export function sanitizeProductEventMetadata({
	metadata,
}: {
	metadata?: Record<string, unknown>;
}) {
	if (!metadata) return {};
	return Object.fromEntries(
		Object.entries(metadata)
			.filter(([key]) => !isSensitiveKey(key))
			.map(([key, value]) => {
				if (
					value === null ||
					typeof value === "string" ||
					typeof value === "number" ||
					typeof value === "boolean"
				) {
					return [key, value];
				}
				if (Array.isArray(value)) {
					return [key, value.slice(0, 20).map((item) => String(item).slice(0, 80))];
				}
				return [key, String(value).slice(0, 120)];
			}),
	);
}
