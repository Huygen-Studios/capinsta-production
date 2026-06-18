"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";

export function DevToolsLoader() {
	const pathname = usePathname();

	// Only load in development
	if (process.env.NODE_ENV !== "development") {
		return null;
	}

	// Never load on the headless render page to avoid injecting purple boxes into video exports
	if (pathname === "/render") {
		return null;
	}

	return (
		<Script
			src="https://unpkg.com/react-scan/dist/auto.global.js"
			strategy="beforeInteractive"
		/>
	);
}
