import type { Event, EventHint } from "@sentry/nextjs";

const SENSITIVE_KEYS = [
	"authorization",
	"cookie",
	"caption",
	"captions",
	"email",
	"mediaUrl",
	"password",
	"payment",
	"razorpay",
	"signedUrl",
	"supabase",
	"token",
	"transcript",
	"url",
] as const;

function redactedKey(key: string) {
	const normalized = key.toLowerCase();
	return SENSITIVE_KEYS.some((sensitive) =>
		normalized.includes(sensitive.toLowerCase()),
	);
}

function sanitizeValue(value: unknown): void {
	if (!value || typeof value !== "object") return;
	for (const [key, item] of Object.entries(value)) {
		if (redactedKey(key)) {
			Reflect.set(value, key, "[Filtered]");
		} else {
			sanitizeValue(item);
		}
	}
}

export function sanitizeSentryEvent<TEvent extends Event>({
	event,
	_hint,
}: {
	event: TEvent;
	_hint?: EventHint;
}): TEvent {
	sanitizeValue(event);
	return event;
}
