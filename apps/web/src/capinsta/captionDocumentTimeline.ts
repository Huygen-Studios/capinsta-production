import type { CapinstaCaptionDocumentRecord } from "./types";
import { resolveCapinstaElementForClip } from "./captionTimelineSync";
import type { SceneTracks, TextElement, TextTrack } from "@/timeline";
import { generateUUID } from "@/utils/id";
import { mediaTimeFromSeconds } from "@/wasm";

export function applyDocumentToTracks({
	record,
	tracks,
}: {
	record: CapinstaCaptionDocumentRecord;
	tracks: SceneTracks;
}): SceneTracks {
	const track = tracks.overlay.find(
		(candidate): candidate is TextTrack =>
			candidate.id === record.openCutTrackId && candidate.type === "text",
	);
	if (!track) return tracks;
	const existingByClip = new Map<string, TextElement>();
	for (const clip of record.document.clips) {
		const element = resolveCapinstaElementForClip({
			record,
			tracks,
			clipId: clip.id,
		});
		if (element) existingByClip.set(clip.id, element);
	}
	const template = track.elements[0];
	if (!template && record.document.clips.length > 0) return tracks;
	const elements = record.document.clips.map((clip, index): TextElement => {
		const existing = existingByClip.get(clip.id);
		const base = existing ?? template!;
		return {
			...base,
			id: existing?.id ?? generateUUID(),
			name: `Caption ${index + 1}`,
			capinstaDocumentId: record.document.id,
			capinstaClipId: clip.id,
			startTime: mediaTimeFromSeconds({ seconds: clip.start }),
			duration: mediaTimeFromSeconds({ seconds: clip.end - clip.start }),
			params: { ...base.params, content: clip.text },
		};
	});
	return {
		...tracks,
		overlay: tracks.overlay.map((candidate) =>
			candidate.id === track.id ? { ...track, elements } : candidate,
		),
	};
}
