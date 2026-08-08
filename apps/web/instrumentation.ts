import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "./src/monitoring/sentry-sanitize";

export async function register() {
	const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

	if (!dsn) {
		return;
	}

	Sentry.init({
		dsn,
		environment: process.env.NODE_ENV,
		release: process.env.COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
		tracesSampleRate: 0.05,
		beforeSend: (event, hint) => sanitizeSentryEvent({ event, _hint: hint }),
	});
}

export const onRequestError = Sentry.captureRequestError;
