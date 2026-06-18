/**
 * CapinstaExportOverlayHost
 *
 * Stub for the React overlay host used by the fallback ForeignObject export path.
 * This path is only active when NEXT_PUBLIC_CAPINSTA_EXPORT_FALLBACK_FOREIGNOBJECT=true.
 * The primary export path uses headless Playwright (no overlay host needed).
 */

import type { CapinstaCaptionDocumentRecord } from "@/capinsta/types";
import type { CapinstaExportOverlayHost } from "./capinsta-overlay-capture";

export async function mountCapinstaExportOverlayHost(_params: {
	records: CapinstaCaptionDocumentRecord[];
	canvasWidth: number;
	canvasHeight: number;
}): Promise<{ host: CapinstaExportOverlayHost }> {
	throw new Error(
		"[capinsta-export] CapinstaExportOverlayHost is not implemented in this build. " +
			"The headless Playwright export path should be used instead.",
	);
}
