"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";

export function DevToolsLoader() {
	const pathname = usePathname();

	// Keep instrumentation opt-in so normal development and visual QA match
	// the production UI instead of drawing component outlines over the editor.
	if (
		process.env.NODE_ENV !== "development" ||
		process.env.NEXT_PUBLIC_REACT_SCAN_ENABLED !== "true"
	) {
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
