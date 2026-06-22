"use client";

import { usePathname } from "next/navigation";
import { CookieConsentBanner } from "./cookie-consent";

export function RouteCookieConsent() {
	const pathname = usePathname();
	if (pathname.startsWith("/admincapinsta11")) return null;
	return <CookieConsentBanner />;
}
