/**
 * capinsta-overlay-capture
 *
 * Stub for the React overlay rasterization pipeline used by the fallback
 * ForeignObject export path. This path is only active when
 * NEXT_PUBLIC_CAPINSTA_EXPORT_FALLBACK_FOREIGNOBJECT=true.
 *
 * The primary export path uses headless Playwright (no overlay host needed).
 */

import type { CapinstaRenderModel } from "@/capinsta/render/capinstaRenderModel";

export interface CapinstaRasterStats {
	rasterized: boolean;
	nonTransparentPixels: number;
}

/**
 * Interface for the React overlay host used during fallback export.
 * Methods mirror what scene-exporter.ts expects.
 */
export interface CapinstaExportOverlayHost {
	/** Advance the overlay DOM to the given time and return the active model. */
	advanceToTime(timeSeconds: number): Promise<CapinstaRenderModel | null>;
	/** Get the overlay's root DOM element for bounding rect / DOM queries. */
	getOverlayElement(): HTMLElement | null;
	/** Unmount React and free resources. */
	dispose(): Promise<void>;
}

export class CapinstaOverlayRasterizationError extends Error {
	frameIndex: number;
	timeSeconds: number;
	clipId: string;
	stats: CapinstaRasterStats;

	constructor(
		message: string,
		info: {
			frameIndex: number;
			timeSeconds: number;
			clipId: string;
			stats: CapinstaRasterStats;
		},
	) {
		super(message);
		this.name = "CapinstaOverlayRasterizationError";
		this.frameIndex = info.frameIndex;
		this.timeSeconds = info.timeSeconds;
		this.clipId = info.clipId;
		this.stats = info.stats;
	}
}

/**
 * Rasterize the React overlay to the given canvas context.
 * Stub: throws because fallback path is not implemented.
 */
export async function rasterizeOverlayToCanvas(_params: {
	host: CapinstaExportOverlayHost;
	targetCtx: CanvasRenderingContext2D;
}): Promise<CapinstaRasterStats> {
	throw new Error(
		"[capinsta-export] rasterizeOverlayToCanvas is not implemented. " +
			"Use the headless Playwright export path instead.",
	);
}
