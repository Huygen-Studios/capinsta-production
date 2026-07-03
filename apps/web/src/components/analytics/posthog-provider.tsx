"use client";

import posthog from "posthog-js";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useCookieConsent } from "@/components/cookie-consent";
import { isAnalyticsExcluded } from "@/components/analytics/google-analytics-provider";
import { createClient } from "@/lib/supabase/client";

let initialized = false;

function projectToken() {
	return (
		process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ||
		process.env.NEXT_PUBLIC_POSTHOG_KEY ||
		""
	);
}

function configured() {
	return Boolean(projectToken() && process.env.NEXT_PUBLIC_POSTHOG_HOST);
}

function ensurePostHog() {
	if (initialized || !configured()) return initialized;
	posthog.init(projectToken(), {
		api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
		defaults: "2026-05-30",
		capture_pageview: false,
		disable_session_recording: true,
		autocapture: false,
		loaded: (instance) => {
			instance.set_config({ disable_session_recording: true });
		},
	});
	initialized = true;
	return true;
}

export function PostHogProvider() {
	const pathname = usePathname();
	const { state } = useCookieConsent();
	const capturedPaths = useRef(new Set<string>());

	useEffect(() => {
		if (!state.analytics || isAnalyticsExcluded(pathname)) {
			if (initialized) posthog.opt_out_capturing();
			return;
		}
		if (!ensurePostHog()) return;
		posthog.opt_in_capturing();
	}, [pathname, state.analytics]);

	useEffect(() => {
		if (!state.analytics || !pathname || isAnalyticsExcluded(pathname)) return;
		if (!ensurePostHog()) return;
		const key = `landing_page_viewed:${pathname}`;
		if (capturedPaths.current.has(key)) return;
		capturedPaths.current.add(key);
		posthog.capture("landing_page_viewed", {
			pathname,
			event_id: key,
		});
	}, [pathname, state.analytics]);

	useEffect(() => {
		if (!state.analytics || !ensurePostHog()) return;
		const supabase = createClient();
		let mounted = true;
		void supabase.auth.getUser().then(({ data }) => {
			if (!mounted) return;
			if (data.user?.id) {
				posthog.identify(data.user.id);
			}
		});
		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((event, session) => {
			if (event === "SIGNED_OUT") {
				posthog.reset();
				return;
			}
			if (session?.user.id) {
				posthog.identify(session.user.id);
			}
		});
		return () => {
			mounted = false;
			subscription.unsubscribe();
		};
	}, [state.analytics]);

	return null;
}
