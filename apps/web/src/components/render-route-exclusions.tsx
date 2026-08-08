"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function isRenderPath(pathname: string): boolean {
	return (
		pathname === "/render" ||
		pathname === "/render.html" ||
		pathname.startsWith("/render/")
	);
}

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
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	// The render route is always exactly "/render" — never nested. We also
	// support a headless query marker for edge cases.
	const isRenderRoute = isRenderPath(pathname);

	// Do not server-render application chrome here. Apart from keeping /render
	// sterile, this avoids a hydration mismatch where the server emits a cookie
	// dialog but the client immediately removes it after learning the pathname.
	if (!mounted || isRenderRoute) {
		return null;
	}

	return <>{children}</>;
}
