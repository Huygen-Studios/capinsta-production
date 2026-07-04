import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "./src/monitoring/sentry-sanitize";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
	Sentry.init({
		dsn,
		environment: process.env.NODE_ENV,
		release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
		tracesSampleRate: 0.05,
		replaysSessionSampleRate: 0,
		replaysOnErrorSampleRate: 0,
		beforeSend: (event, hint) => sanitizeSentryEvent({ event, _hint: hint }),
	});
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
