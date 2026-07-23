export type CapinstaExportStrategy = "headless";
export type CapinstaExportRoute = "headless-worker" | "browser-scene";

export const DEFAULT_CAPINSTA_EXPORT_STRATEGY: CapinstaExportStrategy =
	"headless";

export function resolveCapinstaExportStrategy({
	configured,
	legacyForeignObjectFallback,
}: {
	configured?: string;
	legacyForeignObjectFallback?: string;
} = {}): CapinstaExportStrategy {
	if (legacyForeignObjectFallback?.trim().toLowerCase() === "true") {
		throw new Error(
			"Invalid export configuration: NEXT_PUBLIC_CAPINSTA_EXPORT_FALLBACK_FOREIGNOBJECT is no longer supported. Remove it; CapInsta exports use the headless Playwright worker.",
		);
	}

	const normalized = configured?.trim().toLowerCase();
	if (!normalized || normalized === DEFAULT_CAPINSTA_EXPORT_STRATEGY) {
		return DEFAULT_CAPINSTA_EXPORT_STRATEGY;
	}

	throw new Error(
		`Unsupported CapInsta export strategy "${configured}". Supported strategy: headless.`,
	);
}

export function resolveCapinstaExportRoute({
	exportMode,
	captionRecordCount,
	strategy,
}: {
	exportMode: "full_video" | "captions_solid_background";
	captionRecordCount: number;
	strategy: CapinstaExportStrategy;
}): CapinstaExportRoute {
	if (captionRecordCount <= 0) return "browser-scene";

	switch (exportMode) {
		case "full_video":
		case "captions_solid_background":
			return strategy === "headless" ? "headless-worker" : "browser-scene";
	}
}
