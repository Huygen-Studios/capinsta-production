const CLIENT_ID_PATTERN = /^ca-pub-\d{16}$/;
const SLOT_PATTERN = /^\d+$/;

function enabled(value: string | undefined) {
	return value?.trim().toLowerCase() === "true";
}

function validSlot(value: string | undefined) {
	const normalized = value?.trim() ?? "";
	return SLOT_PATTERN.test(normalized) ? normalized : "";
}

export function parseAdSenseConfig(env: Record<string, string | undefined>) {
	const clientId = env.NEXT_PUBLIC_ADSENSE_CLIENT_ID?.trim() ?? "";
	return {
		enabled:
			enabled(env.NEXT_PUBLIC_ADSENSE_ENABLED) &&
			CLIENT_ID_PATTERN.test(clientId),
		autoAdsEnabled: enabled(env.NEXT_PUBLIC_ADSENSE_AUTO_ADS_ENABLED),
		clientId: CLIENT_ID_PATTERN.test(clientId) ? clientId : "",
		topSlot: validSlot(env.NEXT_PUBLIC_ADSENSE_TOP_SLOT),
		sidebarSlot: validSlot(env.NEXT_PUBLIC_ADSENSE_SIDEBAR_SLOT),
	} as const;
}

export const ADSENSE_CONFIG = parseAdSenseConfig(process.env);

export const ADSENSE_PUBLISHER_ID = ADSENSE_CONFIG.clientId.replace(/^ca-/, "");
export const ADS_TXT_CONTENT = ADSENSE_PUBLISHER_ID
	? `google.com, ${ADSENSE_PUBLISHER_ID}, DIRECT, f08c47fec0942fa0\n`
	: "# Add the authorized Google AdSense seller line through production environment configuration.\n";

export function isAdSenseSlotConfigured(slot: string | undefined) {
	return Boolean(
		ADSENSE_CONFIG.enabled &&
			ADSENSE_CONFIG.clientId &&
			slot &&
			SLOT_PATTERN.test(slot),
	);
}
