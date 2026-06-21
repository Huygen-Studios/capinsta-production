"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { GoogleAnalytics } from "@next/third-parties/google";
import { useCookieConsent } from "@/components/cookie-consent";
import { webEnv } from "@/env/web";

declare global {
	interface Window {
		gtag?: (...args: any[]) => void;
	}
}

export function isAnalyticsExcluded(pathname: string): boolean {
	return (
		pathname === "/render" ||
		pathname === "/render.html" ||
		pathname.startsWith("/render/") ||
		pathname.startsWith("/caption-sync-verify") ||
		pathname.startsWith("/internal")
	);
}

function ConsentSync() {
	const { state } = useCookieConsent();

	useEffect(() => {
		if (typeof window !== "undefined" && typeof window.gtag === "function") {
			window.gtag("consent", "update", {
				analytics_storage: state.analytics ? "granted" : "denied",
				ad_storage: state.advertising ? "granted" : "denied",
				ad_user_data: state.advertising ? "granted" : "denied",
				ad_personalization: state.advertising ? "granted" : "denied",
			});
		}
	}, [state.analytics, state.advertising]);

	return null;
}

export function GoogleAnalyticsProvider() {
	const pathname = usePathname();

	if (isAnalyticsExcluded(pathname)) {
		return null;
	}

	const gaId = webEnv.NEXT_PUBLIC_GA_MEASUREMENT_ID;

	if (!gaId) {
		if (webEnv.NODE_ENV === "development") {
			console.warn("Google Analytics is disabled (NEXT_PUBLIC_GA_MEASUREMENT_ID is not set).");
		}
		return null;
	}

	return (
		<>
			<script
				id="ga-consent-init"
				dangerouslySetInnerHTML={{
					__html: `
						window.dataLayer = window.dataLayer || [];
						function gtag(){dataLayer.push(arguments);}
						gtag('consent', 'default', {
							'analytics_storage': 'denied',
							'ad_storage': 'denied',
							'ad_user_data': 'denied',
							'ad_personalization': 'denied',
							'wait_for_update': 500
						});
					`,
				}}
			/>
			<ConsentSync />
			<GoogleAnalytics gaId={gaId} />
		</>
	);
}
