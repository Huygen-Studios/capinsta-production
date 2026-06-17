/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- Bulk helpers intentionally expose compact path/value APIs for style selection. */
import type { TextElement, TimelineElement, SceneTracks } from "@/timeline";
import type { TextTrack } from "@/timeline";
import type {
	CapinstaCaptionDocumentRecord,
	NeutralCaptionClip,
} from "./types";
import { rechunkNeutralCaptionDocumentForPreset } from "./adapter";
import {
	findCapinstaBindingForElement,
	resolveCapinstaElementForClip,
} from "./captionTimelineSync";
import {
	applyCapinstaPresetToClipStyle,
	resolveCapinstaClipStyle,
	updateCapinstaClipStyle,
} from "./styles/styleMigration";
import { styleToExport } from "./styles/styleToExport";
import type {
	CapinstaCaptionPresetId,
	CapinstaCaptionStylePatch,
	CapinstaCaptionStyleV1,
} from "./styles/styleTypes";
import { mediaTimeFromSeconds } from "@/wasm";

export interface CapinstaCaptionSelectionRef {
	elementId: string;
	trackId: string;
	documentId: string;
	clipId: string;
	record: CapinstaCaptionDocumentRecord;
	clip: NeutralCaptionClip;
	element: TextElement;
	style: CapinstaCaptionStyleV1;
}

export interface CapinstaCaptionSelectionResult {
	selectedCapinstaClipRefs: CapinstaCaptionSelectionRef[];
	ignoredCount: number;
}

export interface TimelineTextStyleUpdate {
	trackId: string;
	elementId: string;
	patch: Pick<TextElement, "params">;
}

export interface CapinstaBulkStyleUpdateResult {
	records: CapinstaCaptionDocumentRecord[];
	timelineUpdates: TimelineTextStyleUpdate[];
	tracks?: SceneTracks;
}

type SelectedElementRef = {
	trackId: string;
	elementId: string;
};

function getAllTracks(tracks: SceneTracks) {
	return [tracks.main, ...tracks.overlay, ...tracks.audio];
}

function getElementByRef({
	tracks,
	ref,
}: {
	tracks: SceneTracks;
	ref: SelectedElementRef;
}): TimelineElement | null {
	const track = getAllTracks(tracks).find((candidate) => candidate.id === ref.trackId);
	return track?.elements.find((element) => element.id === ref.elementId) ?? null;
}

function buildSelectionRef({
	binding,
	trackId,
}: {
	binding: NonNullable<ReturnType<typeof findCapinstaBindingForElement>>;
	trackId: string;
}): CapinstaCaptionSelectionRef {
	return {
		elementId: binding.element.id,
		trackId,
		documentId: binding.record.document.id,
		clipId: binding.clip.id,
		record: binding.record,
		clip: binding.clip,
		element: binding.element,
		style: resolveCapinstaClipStyle({
			document: binding.record.document,
			clip: binding.clip,
		}),
	};
}

export function getSelectedCapinstaCaptionRefs({
	selection,
	tracks,
	records,
}: {
	selection: SelectedElementRef[];
	tracks: SceneTracks;
	records: CapinstaCaptionDocumentRecord[];
}): CapinstaCaptionSelectionResult {
	const selectedCapinstaClipRefs: CapinstaCaptionSelectionRef[] = [];
	let ignoredCount = 0;
	const seen = new Set<string>();

	for (const selected of selection) {
		const element = getElementByRef({ tracks, ref: selected });
		if (!element) {
			ignoredCount += 1;
			continue;
		}

		const binding = findCapinstaBindingForElement({
			records,
			tracks,
			element,
		});
		if (!binding) {
			ignoredCount += 1;
			continue;
		}

		const key = `${binding.record.document.id}:${binding.clip.id}:${binding.element.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		selectedCapinstaClipRefs.push(
			buildSelectionRef({ binding, trackId: selected.trackId }),
		);
	}

	return { selectedCapinstaClipRefs, ignoredCount };
}

function readPath(value: unknown, path: string): unknown {
	return path.split(".").reduce<unknown>((current, segment) => {
		if (typeof current !== "object" || current === null) return undefined;
		return (current as Record<string, unknown>)[segment];
	}, value);
}

export function getCommonStyleValue<T = unknown>(
	selectedRefs: CapinstaCaptionSelectionRef[],
	path: string,
): T | undefined {
	if (selectedRefs.length === 0) return undefined;

	const [firstRef, ...restRefs] = selectedRefs;
	const firstValue = readPath(firstRef?.style, path);
	const hasMixedValue = restRefs.some(
		(ref) => !Object.is(readPath(ref.style, path), firstValue),
	);

	return hasMixedValue ? undefined : (firstValue as T);
}

function replaceRecord(
	records: CapinstaCaptionDocumentRecord[],
	nextRecord: CapinstaCaptionDocumentRecord,
): CapinstaCaptionDocumentRecord[] {
	return records.map((record) =>
		record.document.id === nextRecord.document.id ? nextRecord : record,
	);
}

function buildTimelineTextStyleUpdates({
	refs,
	records,
	tracks,
}: {
	refs: CapinstaCaptionSelectionRef[];
	records: CapinstaCaptionDocumentRecord[];
	tracks: SceneTracks;
}): TimelineTextStyleUpdate[] {
	return refs.flatMap((ref) => {
		const record = records.find((candidate) => candidate.document.id === ref.documentId);
		const clip = record?.document.clips.find(
			(candidate) => candidate.id === ref.clipId,
		);
		if (!record || !clip) return [];

		const element =
			resolveCapinstaElementForClip({
				record,
				tracks,
				clipId: clip.id,
			}) ?? ref.element;
		const exportStyle = styleToExport({
			style: resolveCapinstaClipStyle({ document: record.document, clip }),
			timingNeedsReview: clip.timingNeedsReview,
		});

		return [
			{
				trackId: ref.trackId,
				elementId: element.id,
				patch: {
					params: {
						...element.params,
						...exportStyle.textParams,
					},
				},
			},
		];
	});
}

function selectedDocumentIdsForFullRechunk({
	records,
	selectedRefs,
}: {
	records: CapinstaCaptionDocumentRecord[];
	selectedRefs: CapinstaCaptionSelectionRef[];
}): Set<string> {
	const selectedClipIdsByDocument = new Map<string, Set<string>>();
	for (const ref of selectedRefs) {
		const selectedClipIds =
			selectedClipIdsByDocument.get(ref.documentId) ?? new Set<string>();
		selectedClipIds.add(ref.clipId);
		selectedClipIdsByDocument.set(ref.documentId, selectedClipIds);
	}

	const documentIds = new Set<string>();
	for (const record of records) {
		const selectedClipIds = selectedClipIdsByDocument.get(record.document.id);
		if (!selectedClipIds) continue;
		if (
			record.document.clips.length > 0 &&
			record.document.clips.every((clip) => selectedClipIds.has(clip.id))
		) {
			documentIds.add(record.document.id);
		}
	}
	return documentIds;
}

function buildRechunkedTextElement({
	record,
	clip,
	template,
	index,
}: {
	record: CapinstaCaptionDocumentRecord;
	clip: NeutralCaptionClip;
	template: TextElement;
	index: number;
}): TextElement {
	const exportStyle = styleToExport({
		style: resolveCapinstaClipStyle({ document: record.document, clip }),
		timingNeedsReview: clip.timingNeedsReview,
	});
	return {
		...template,
		id: template.capinstaClipId === clip.id ? template.id : `${template.id}-${clip.id}`,
		name: `Caption ${index + 1}`,
		startTime: mediaTimeFromSeconds({ seconds: clip.start }),
		duration: mediaTimeFromSeconds({ seconds: clip.end - clip.start }),
		trimStart: 0 as TextElement["trimStart"],
		trimEnd: 0 as TextElement["trimEnd"],
		capinstaDocumentId: record.document.id,
		capinstaClipId: clip.id,
		params: {
			...template.params,
			...exportStyle.textParams,
			content: clip.text,
		},
	};
}

function replaceDocumentTextElements({
	tracks,
	record,
	templateRefs,
}: {
	tracks: SceneTracks;
	record: CapinstaCaptionDocumentRecord;
	templateRefs: CapinstaCaptionSelectionRef[];
}): SceneTracks {
	const template = templateRefs[0]?.element;
	if (!template) return tracks;

	const replaceTrackElements = (track: TextTrack): TextTrack => {
		if (track.id !== record.openCutTrackId) return track;
		const firstDocumentElementIndex = track.elements.findIndex(
			(element) => element.capinstaDocumentId === record.document.id,
		);
		if (firstDocumentElementIndex < 0) return track;
		const oldElementsByClipId = new Map(
			track.elements
				.filter((element): element is TextElement => element.type === "text")
				.filter((element) => element.capinstaDocumentId === record.document.id)
				.map((element) => [element.capinstaClipId, element]),
		);
		const retainedElements = track.elements.filter(
			(element) => element.capinstaDocumentId !== record.document.id,
		);
		const nextCaptionElements = record.document.clips.map((clip, index) =>
			buildRechunkedTextElement({
				record,
				clip,
				template: oldElementsByClipId.get(clip.id) ?? template,
				index,
			}),
		);
		return {
			...track,
			elements: [
				...retainedElements.slice(0, firstDocumentElementIndex),
				...nextCaptionElements,
				...retainedElements.slice(firstDocumentElementIndex),
			],
		};
	};

	return {
		...tracks,
		overlay: tracks.overlay.map((track) =>
			track.type === "text" ? replaceTrackElements(track) : track,
		),
	};
}

export function applyStylePatchToCapinstaSelection({
	records,
	tracks,
	selectedRefs,
	stylePatch,
}: {
	records: CapinstaCaptionDocumentRecord[];
	tracks: SceneTracks;
	selectedRefs: CapinstaCaptionSelectionRef[];
	stylePatch: CapinstaCaptionStylePatch;
}): CapinstaBulkStyleUpdateResult {
	let nextRecords = records;

	for (const ref of selectedRefs) {
		const record = nextRecords.find(
			(candidate) => candidate.document.id === ref.documentId,
		);
		if (!record) continue;
		nextRecords = replaceRecord(
			nextRecords,
			updateCapinstaClipStyle({
				record,
				clipId: ref.clipId,
				patch: stylePatch,
			}),
		);
	}

	return {
		records: nextRecords,
		timelineUpdates: buildTimelineTextStyleUpdates({
			refs: selectedRefs,
			records: nextRecords,
			tracks,
		}),
	};
}

export function applyPresetToCapinstaSelection({
	records,
	tracks,
	selectedRefs,
	presetId,
}: {
	records: CapinstaCaptionDocumentRecord[];
	tracks: SceneTracks;
	selectedRefs: CapinstaCaptionSelectionRef[];
	presetId: CapinstaCaptionPresetId;
}): CapinstaBulkStyleUpdateResult {
	let nextRecords = records;
	let nextTracks: SceneTracks | undefined;
	const rechunkDocumentIds = selectedDocumentIdsForFullRechunk({
		records,
		selectedRefs,
	});

	if (rechunkDocumentIds.size > 0) {
		nextRecords = nextRecords.map((record) =>
			rechunkDocumentIds.has(record.document.id)
				? {
						...record,
						document: rechunkNeutralCaptionDocumentForPreset({
							document: record.document,
							presetId,
						}),
					}
				: record,
		);
		nextTracks = nextRecords.reduce<SceneTracks>((currentTracks, record) => {
			if (!rechunkDocumentIds.has(record.document.id)) return currentTracks;
			return replaceDocumentTextElements({
				tracks: currentTracks,
				record,
				templateRefs: selectedRefs.filter(
					(ref) => ref.documentId === record.document.id,
				),
			});
		}, tracks);
	}

	for (const ref of selectedRefs) {
		if (rechunkDocumentIds.has(ref.documentId)) continue;
		const record = nextRecords.find(
			(candidate) => candidate.document.id === ref.documentId,
		);
		if (!record) continue;
		nextRecords = replaceRecord(
			nextRecords,
			applyCapinstaPresetToClipStyle({
				record,
				clipId: ref.clipId,
				presetId,
			}),
		);
	}

	return {
		records: nextRecords,
		timelineUpdates: buildTimelineTextStyleUpdates({
			refs: selectedRefs.filter((ref) => !rechunkDocumentIds.has(ref.documentId)),
			records: nextRecords,
			tracks: nextTracks ?? tracks,
		}),
		tracks: nextTracks,
	};
}

export function resetStyleForCapinstaSelection({
	records,
	tracks,
	selectedRefs,
}: {
	records: CapinstaCaptionDocumentRecord[];
	tracks: SceneTracks;
	selectedRefs: CapinstaCaptionSelectionRef[];
}): CapinstaBulkStyleUpdateResult {
	let nextRecords = records;

	for (const ref of selectedRefs) {
		const presetId =
			getCommonStyleValue<CapinstaCaptionPresetId>(selectedRefs, "presetId") ??
			ref.style.presetId;
		const record = nextRecords.find(
			(candidate) => candidate.document.id === ref.documentId,
		);
		if (!record) continue;
		nextRecords = replaceRecord(
			nextRecords,
			applyCapinstaPresetToClipStyle({
				record,
				clipId: ref.clipId,
				presetId,
			}),
		);
	}

	return {
		records: nextRecords,
		timelineUpdates: buildTimelineTextStyleUpdates({
			refs: selectedRefs,
			records: nextRecords,
			tracks,
		}),
	};
}
