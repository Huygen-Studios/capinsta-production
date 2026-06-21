"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";
import { ADSENSE_CONFIG, isAdSenseSlotConfigured } from "@/site/ads";
import { useCookieConsent } from "@/components/cookie-consent";
import { cn } from "@/utils/ui";

declare global {
	interface Window {
		adsbygoogle?: Record<string, unknown>[];
	}
}

export interface AdSenseUnitProps {
	slot?: string;
	format?: "auto" | "rectangle" | "vertical" | "horizontal";
	responsive?: boolean;
	className?: string;
	label?: "Advertisements" | "Sponsored Links";
	reservedWidth?: number;
	reservedHeight?: number;
}

export function AdSenseUnit({
	slot,
	format = "auto",
	responsive = true,
	className,
	label = "Advertisements",
	reservedWidth,
	reservedHeight,
}: AdSenseUnitProps) {
	const { state, hydrated } = useCookieConsent();
	const pushed = useRef(false);
	const configured = isAdSenseSlotConfigured(slot);
	const canLoad =
		configured &&
		hydrated &&
		state.advertising &&
		process.env.NODE_ENV === "production";

	useEffect(() => {
		if (!canLoad || pushed.current) return;
		try {
			(window.adsbygoogle = window.adsbygoogle ?? []).push({});
			pushed.current = true;
		} catch (error) {
			if (process.env.NODE_ENV === "production") throw error;
		}
	}, [canLoad]);

	if (!configured) return null;

	const style = {
		minWidth: reservedWidth,
		minHeight: reservedHeight,
	} as const;

	if (process.env.NODE_ENV !== "production") {
		return (
			<aside
				aria-label={label}
				className={cn("adsense-placeholder", className)}
				style={style}
			>
				<span>{label}</span>
				<small>Development placeholder</small>
			</aside>
		);
	}

	if (!canLoad) return null;

	return (
		<aside aria-label={label} className={cn("adsense-region", className)} style={style}>
			<Script
				id="capinsta-adsense-script"
				async
				strategy="afterInteractive"
				crossOrigin="anonymous"
				src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CONFIG.clientId}`}
			/>
			<span className="adsense-label">{label}</span>
			<ins
				className="adsbygoogle block"
				data-ad-client={ADSENSE_CONFIG.clientId}
				data-ad-slot={slot}
				data-ad-format={format}
				data-full-width-responsive={responsive ? "true" : "false"}
				data-ad-status="loading"
			/>
		</aside>
	);
}
