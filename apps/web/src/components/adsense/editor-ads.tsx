import { ADSENSE_CONFIG } from "@/site/ads";
import { AdSenseUnit } from "./adsense-unit";

export function EditorTopAd() {
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
