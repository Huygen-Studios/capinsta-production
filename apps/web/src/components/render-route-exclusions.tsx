"use client";

import { usePathname } from "next/navigation";

/**
 * Gate that prevents application-only UI from mounting on the headless
 * render route (`/render`). The render page must be a sterile surface:
 * no cookie consent banners, toasts, navigation, chat widgets, analytics
 * scripts, or fixed application controls.
 *
 * Usage in root layout:
 *   <RenderRouteExclusions>
 *     <Toaster />
 *     <CookieConsentBanner />
 *     <Analytics />
 *   </RenderRouteExclusions>
 *
 * Components mounted inside this wrapper will ONLY render on routes other
 * than /render and /render?* (with headlessExport marker support).
 */
export function RenderRouteExclusions({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();

	// The render route is always exactly "/render" — never nested. We also
	// support a headless query marker for edge cases.
	const isRenderRoute =
		pathname === "/render" || pathname.startsWith("/render?") || pathname.startsWith("/render#");

	if (isRenderRoute) {
		return null;
	}

	return <>{children}</>;
}
