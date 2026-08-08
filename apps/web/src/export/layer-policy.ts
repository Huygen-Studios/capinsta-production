import type { SceneTracks, TimelineTrack } from "@/timeline";
import type { ExportMode } from "./index";

export type ExportLayerPolicy =
	| "all-visible-layers"
	| "overlay-layers-on-solid-background";

export function exportLayerPolicyForMode({
	exportMode,
}: {
	exportMode: ExportMode;
}): ExportLayerPolicy {
	return exportMode === "full_video"
		? "all-visible-layers"
		: "overlay-layers-on-solid-background";
}

export function applyExportLayerPolicy({
	tracks,
	policy,
}: {
	tracks: SceneTracks;
	policy: ExportLayerPolicy;
}): SceneTracks {
	if (policy === "all-visible-layers") return tracks;
	return {
		main: { ...tracks.main, elements: [] },
		overlay: tracks.overlay.map((track) =>
			track.type === "video" ? { ...track, elements: [] } : track,
		),
		audio: tracks.audio,
	};
}

export function hasIndependentVisualLayers({
	tracks,
}: {
	tracks: SceneTracks;
}): boolean {
	return [...tracks.overlay, tracks.main].some((track) =>
		trackIsVisiblyPopulated({ track }),
	);
}

function trackIsVisiblyPopulated({ track }: { track: TimelineTrack }): boolean {
	if ("hidden" in track && track.hidden) return false;
	return track.elements.some(
		(element) => !("hidden" in element && element.hidden),
	);
}
