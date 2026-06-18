import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isGuideId, type GuideId } from "@/guides";
import { DEFAULT_GRID_CONFIG } from "@/guides/grid";
import type { GridConfig } from "@/guides/types";

/**
 * Preview quality levels, analogous to Premiere Pro's playback resolution.
 *
 * - "full":   Render at project resolution (e.g. 1080×1920).
 * - "half":   Render at half resolution (e.g. 540×960).
 * - "quarter": Render at quarter resolution (e.g. 270×480).
 * - "auto":   Dynamically choose based on measured FPS (starts full,
 *             degrades when FPS drops, recovers when FPS recovers).
 */
export type PreviewQuality = "full" | "half" | "quarter" | "auto";

/**
 * The effective (resolved) quality level. "auto" resolves to one of the
 * concrete levels.
 */
export type ResolvedPreviewQuality = "full" | "half" | "quarter";

export const PREVIEW_QUALITY_SCALE: Record<ResolvedPreviewQuality, number> = {
	full: 1.0,
	half: 0.5,
	quarter: 0.25,
};

export const PREVIEW_QUALITY_LABELS: Record<PreviewQuality, string> = {
	full: "Full",
	half: "1/2",
	quarter: "1/4",
	auto: "Auto",
};

export function isPreviewQuality(value: string): value is PreviewQuality {
	return (
		value === "full" ||
		value === "half" ||
		value === "quarter" ||
		value === "auto"
	);
}

export function computePreviewDimensions({
	projectWidth,
	projectHeight,
	scale,
}: {
	projectWidth: number;
	projectHeight: number;
	scale: number;
}): { width: number; height: number } {
	// Ensure minimum 1px dimension to avoid degenerate canvas
	return {
		width: Math.max(1, Math.round(projectWidth * scale)),
		height: Math.max(1, Math.round(projectHeight * scale)),
	};
}

type PreviewOverlaysState = Record<string, boolean>;

interface PersistedPreviewState {
	activeGuide?: string | null;
	layoutGuide?: {
		platform?: string | null;
	};
	overlays?: PreviewOverlaysState;
	gridConfig?: GridConfig;
	previewQuality?: PreviewQuality;
}

interface PreviewState {
	activeGuide: GuideId | null;
	overlays: PreviewOverlaysState;
	gridConfig: GridConfig;
	/** User-selected preview quality (may be "auto"). */
	previewQuality: PreviewQuality;
	/** Effective quality resolved by the auto-controller (same as previewQuality for non-auto). */
	resolvedQuality: ResolvedPreviewQuality;
	toggleGuide: (guideId: GuideId) => void;
	setGridConfig: (config: Partial<GridConfig>) => void;
	setOverlayVisibility: ({
		overlayId,
		isVisible,
	}: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
	toggleOverlayVisibility: ({ overlayId }: { overlayId: string }) => void;
	setPreviewQuality: (quality: PreviewQuality) => void;
	setResolvedQuality: (quality: ResolvedPreviewQuality) => void;
}

const DEFAULT_PREVIEW_OVERLAYS: PreviewOverlaysState = {};

function getPersistedActiveGuide(
	state: PersistedPreviewState | undefined,
): GuideId | null {
	const persistedGuide =
		state?.activeGuide ?? state?.layoutGuide?.platform ?? null;

	if (typeof persistedGuide !== "string") {
		return null;
	}

	return isGuideId(persistedGuide) ? persistedGuide : null;
}

function getPersistedPreviewQuality(
	state: PersistedPreviewState | undefined,
): PreviewQuality {
	const quality = state?.previewQuality;
	if (quality && isPreviewQuality(quality)) {
		return quality;
	}
	return "full";
}

function readPersistedPreviewState(
	value: unknown,
): PersistedPreviewState | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	return value as PersistedPreviewState;
}

export const usePreviewStore = create<PreviewState>()(
	persist(
		(set) => ({
			activeGuide: null,
			overlays: DEFAULT_PREVIEW_OVERLAYS,
			gridConfig: DEFAULT_GRID_CONFIG,
			previewQuality: "full" as PreviewQuality,
			resolvedQuality: "full" as ResolvedPreviewQuality,
			toggleGuide: (guideId) => {
				set((state) => ({
					activeGuide: state.activeGuide === guideId ? null : guideId,
				}));
			},
			setGridConfig: (config) => {
				set((state) => ({
					gridConfig: { ...state.gridConfig, ...config },
				}));
			},
			setOverlayVisibility: ({ overlayId, isVisible }) => {
				set((state) => ({
					overlays: {
						...state.overlays,
						[overlayId]: isVisible,
					},
				}));
			},
			toggleOverlayVisibility: ({ overlayId }) => {
				set((state) => ({
					overlays: {
						...state.overlays,
						[overlayId]: !state.overlays[overlayId],
					},
				}));
			},
			setPreviewQuality: (quality) => {
				set({
					previewQuality: quality,
					// Auto always begins at Full and adapts only while playing.
					resolvedQuality: quality === "auto" ? "full" : quality,
				});
			},
			setResolvedQuality: (quality) => {
				set({ resolvedQuality: quality });
			},
		}),
		{
			name: "preview-settings",
			version: 7,
			migrate: (persistedState) => {
				const state = readPersistedPreviewState(persistedState);
				const quality = getPersistedPreviewQuality(state);

				return {
					activeGuide: getPersistedActiveGuide(state),
					overlays: DEFAULT_PREVIEW_OVERLAYS,
					gridConfig: {
						rows: state?.gridConfig?.rows ?? DEFAULT_GRID_CONFIG.rows,
						cols: state?.gridConfig?.cols ?? DEFAULT_GRID_CONFIG.cols,
					},
					previewQuality: quality,
					resolvedQuality: quality === "auto" ? "full" : quality,
				};
			},
			partialize: (state) => ({
				activeGuide: state.activeGuide,
				overlays: state.overlays,
				gridConfig: state.gridConfig,
				previewQuality: state.previewQuality,
			}),
		},
	),
);
