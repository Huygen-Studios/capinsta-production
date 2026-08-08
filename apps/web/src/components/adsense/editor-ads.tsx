"use client";

import { usePublicRuntimeFlag } from "@/admin/use-public-runtime-flag";
import { ADSENSE_CONFIG } from "@/site/ads";
import { AdSenseUnit } from "./adsense-unit";

export function EditorTopAd() {
	const enabled = usePublicRuntimeFlag({ key: "advertisements_enabled" });
	if (!enabled) return null;
	return (
		<div className="editor-top-ad">
			<AdSenseUnit
				slot={ADSENSE_CONFIG.topSlot}
				format="horizontal"
				reservedHeight={90}
				className="mx-auto w-full max-w-[1100px]"
			/>
		</div>
	);
}

export function EditorAdRail() {
	const enabled = usePublicRuntimeFlag({ key: "advertisements_enabled" });
	if (!enabled) return null;
	return (
		<aside className="editor-ad-rail" aria-label="Advertising rail">
			<AdSenseUnit
				slot={ADSENSE_CONFIG.sidebarSlot}
				format="vertical"
				responsive={false}
				reservedWidth={300}
				reservedHeight={600}
			/>
		</aside>
	);
}
