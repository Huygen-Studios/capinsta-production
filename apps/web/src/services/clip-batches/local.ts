/* eslint-disable opencut/prefer-object-params -- Small immutable domain transforms compose more clearly positionally. */
import type { MediaAsset } from "@/media/types";
import type {
	LocalClipBatchV1,
	LocalClipEditorStateV1,
	LocalClipItemV1,
	LocalClipPlatformPresetV1,
	TProject,
	TProjectSettings,
} from "@/project/types";
import {
	buildElementFromMedia,
	buildTextElement,
} from "@/timeline/element-utils";
import { buildDefaultScene } from "@/timeline/scenes";
import type { TextElement, TextTrack, VideoElement } from "@/timeline";
import { generateUUID } from "@/utils/id";
import { mediaTime, mediaTimeFromSeconds, ZERO_MEDIA_TIME } from "@/wasm";
import type { ClipRange } from "./ranges";

export const MAX_LOCAL_CLIP_COUNT = 12;

export function snapshotClipEditorState(
	project: TProject,
	scenes = project.scenes,
): LocalClipEditorStateV1 {
	return structuredClone({
		scenes,
		currentSceneId: project.currentSceneId,
		settings: project.settings,
		timelineViewState: project.timelineViewState,
		capinstaCaptionDocuments: project.capinstaCaptionDocuments,
	});
}

export function persistSelectedClipState({
	project,
	scenes,
}: {
	project: TProject;
	scenes: TProject["scenes"];
}): TProject {
	const batch = project.capinstaLocalClipBatch;
	if (!batch) return { ...project, scenes };
	const now = new Date().toISOString();
	const editorProjectState = snapshotClipEditorState(project, scenes);
	if (project.capinstaEditorMode !== "clipping" || !batch.selectedClipId) {
		return {
			...project,
			scenes,
			capinstaLocalClipBatch: {
				...batch,
				normalEditorProjectState: editorProjectState,
				updatedAt: now,
			},
		};
	}
	return {
		...project,
		scenes,
		capinstaLocalClipBatch: {
			...batch,
			updatedAt: now,
			items: batch.items.map((item) =>
				item.id === batch.selectedClipId
					? { ...item, editorProjectState, updatedAt: now }
					: item,
			),
		},
	};
}

export function activateClip(
	project: TProject,
	batch: LocalClipBatchV1,
	clipId: string,
): TProject {
	const item = batch.items.find((candidate) => candidate.id === clipId);
	if (!item) throw new Error("Clip could not be found.");
	const state = structuredClone(item.editorProjectState);
	return {
		...project,
		scenes: state.scenes,
		currentSceneId: state.currentSceneId,
		settings: state.settings,
		timelineViewState: state.timelineViewState,
		capinstaCaptionDocuments: state.capinstaCaptionDocuments,
		capinstaLocalClipBatch: {
			...batch,
			selectedClipId: clipId,
			updatedAt: new Date().toISOString(),
		},
		capinstaEditorMode: "clipping",
	};
}

export function activateNormalEditor(
	project: TProject,
	batch: LocalClipBatchV1,
): TProject {
	const state = structuredClone(batch.normalEditorProjectState);
	return {
		...project,
		scenes: state.scenes,
		currentSceneId: state.currentSceneId,
		settings: state.settings,
		timelineViewState: state.timelineViewState,
		capinstaCaptionDocuments: state.capinstaCaptionDocuments,
		capinstaLocalClipBatch: batch,
		capinstaEditorMode: "normal",
	};
}

export function createLocalClipBatch({
	project,
	source,
	ranges,
	maximumClipDurationMs,
	platformPreset,
	captionsEnabled,
	headingsEnabled,
}: {
	project: TProject;
	source: MediaAsset;
	ranges: ClipRange[];
	maximumClipDurationMs: number;
	platformPreset: LocalClipPlatformPresetV1;
	captionsEnabled: boolean;
	headingsEnabled: boolean;
}): LocalClipBatchV1 {
	if (source.type !== "video" || !source.duration || source.duration <= 0) {
		throw new Error("Import a local video before creating clips.");
	}
	if (ranges.length < 1 || ranges.length > MAX_LOCAL_CLIP_COUNT)
		throw new Error("Create between 1 and 12 clips.");
	const sourceDurationMs = Math.round(source.duration * 1000);
	const aspectRatio =
		platformPreset === "custom"
			? project.settings.canvasSize
			: { width: 1080, height: 1920 };
	const settings: TProjectSettings = {
		...project.settings,
		canvasSize: aspectRatio,
		canvasSizeMode:
			platformPreset === "custom" ? project.settings.canvasSizeMode : "preset",
	};
	const now = new Date().toISOString();
	const items = ranges.map((range, index): LocalClipItemV1 => {
		const id = generateUUID();
		return {
			schemaVersion: 1,
			id,
			ordinal: index + 1,
			title: `Clip ${index + 1}`,
			...range,
			selectedForExport: true,
			captionsEnabled,
			headingEnabled: headingsEnabled,
			captionStatus: "idle",
			exportStatus: "idle",
			editorProjectState: createClipEditorState({
				source,
				range,
				settings,
				headingsEnabled,
			}),
			createdAt: now,
			updatedAt: now,
		};
	});
	return {
		schemaVersion: 1,
		id: generateUUID(),
		title: project.metadata.name,
		sourceMediaId: source.id,
		sourceFileName: source.name,
		sourceDurationMs,
		sourceMimeType: source.file.type,
		platformPreset,
		aspectRatio,
		captionsEnabled,
		headingsEnabled,
		maximumClipDurationMs,
		clipOrder: items.map((item) => item.id),
		selectedClipId: items[0]?.id ?? null,
		normalEditorProjectState: snapshotClipEditorState(project),
		items,
		createdAt: now,
		updatedAt: now,
	};
}

export function orderedClipItems(batch: LocalClipBatchV1): LocalClipItemV1[] {
	const byId = new Map(batch.items.map((item) => [item.id, item]));
	return batch.clipOrder.flatMap((id) => byId.get(id) ?? []);
}

export function duplicateLocalClip(
	batch: LocalClipBatchV1,
	itemId: string,
): LocalClipBatchV1 {
	const source = batch.items.find((item) => item.id === itemId);
	if (!source || batch.items.length >= MAX_LOCAL_CLIP_COUNT) return batch;
	const id = generateUUID();
	const now = new Date().toISOString();
	const duplicate: LocalClipItemV1 = {
		...structuredClone(source),
		id,
		title: `${source.title} copy`,
		createdAt: now,
		updatedAt: now,
	};
	const index = batch.clipOrder.indexOf(itemId) + 1;
	const clipOrder = [...batch.clipOrder];
	clipOrder.splice(index, 0, id);
	return renumber({
		...batch,
		clipOrder,
		items: [...batch.items, duplicate],
		updatedAt: now,
	});
}

export function removeLocalClip(
	batch: LocalClipBatchV1,
	itemId: string,
): LocalClipBatchV1 {
	if (batch.items.length <= 1) return batch;
	const clipOrder = batch.clipOrder.filter((id) => id !== itemId);
	return renumber({
		...batch,
		clipOrder,
		items: batch.items.filter((item) => item.id !== itemId),
		selectedClipId:
			batch.selectedClipId === itemId
				? (clipOrder[0] ?? null)
				: batch.selectedClipId,
		updatedAt: new Date().toISOString(),
	});
}

export function reorderLocalClip(
	batch: LocalClipBatchV1,
	itemId: string,
	delta: number,
): LocalClipBatchV1 {
	const from = batch.clipOrder.indexOf(itemId);
	const to = from + delta;
	if (from < 0 || to < 0 || to >= batch.clipOrder.length) return batch;
	const clipOrder = [...batch.clipOrder];
	[clipOrder[from], clipOrder[to]] = [clipOrder[to]!, clipOrder[from]!];
	return renumber({ ...batch, clipOrder, updatedAt: new Date().toISOString() });
}

export function updateLocalClip(
	batch: LocalClipBatchV1,
	itemId: string,
	patch: Partial<LocalClipItemV1>,
): LocalClipBatchV1 {
	const now = new Date().toISOString();
	return {
		...batch,
		updatedAt: now,
		items: batch.items.map((item) =>
			item.id === itemId
				? { ...item, ...patch, id: item.id, updatedAt: now }
				: item,
		),
	};
}

export function countElementsOutsideRange(
	item: LocalClipItemV1,
	sourceStartMs: number,
	sourceEndMs: number,
): number {
	const duration = mediaTimeFromSeconds({
		seconds: (sourceEndMs - sourceStartMs) / 1000,
	});
	let count = 0;
	for (const scene of item.editorProjectState.scenes) {
		for (const track of scene.tracks.overlay) {
			for (const element of track.elements) {
				if (element.startTime + element.duration > duration) count += 1;
			}
		}
		for (const track of scene.tracks.audio) {
			for (const element of track.elements) {
				if (element.startTime + element.duration > duration) count += 1;
			}
		}
	}
	return count;
}

export function retimeLocalClip(
	item: LocalClipItemV1,
	sourceStartMs: number,
	sourceEndMs: number,
	sourceDurationMs: number,
): LocalClipItemV1 {
	const state = structuredClone(item.editorProjectState);
	const duration = mediaTimeFromSeconds({
		seconds: (sourceEndMs - sourceStartMs) / 1000,
	});
	const trimStart = mediaTimeFromSeconds({ seconds: sourceStartMs / 1000 });
	const trimEnd = mediaTimeFromSeconds({
		seconds: (sourceDurationMs - sourceEndMs) / 1000,
	});
	for (const scene of state.scenes) {
		for (const element of scene.tracks.main.elements) {
			if (element.type === "video")
				Object.assign(element, { duration, trimStart, trimEnd });
		}
		for (const track of [...scene.tracks.overlay, ...scene.tracks.audio]) {
			for (const element of track.elements) {
				if (element.startTime >= duration)
					element.startTime = mediaTime({ ticks: Math.max(0, duration - 1) });
				element.duration = mediaTime({
					ticks: Math.min(element.duration, duration - element.startTime),
				});
			}
		}
	}
	return {
		...item,
		sourceStartMs,
		sourceEndMs,
		editorProjectState: state,
		updatedAt: new Date().toISOString(),
	};
}

function renumber(batch: LocalClipBatchV1): LocalClipBatchV1 {
	const ordinals = new Map(batch.clipOrder.map((id, index) => [id, index + 1]));
	return {
		...batch,
		items: batch.items.map((item) => ({
			...item,
			ordinal: ordinals.get(item.id) ?? item.ordinal,
		})),
	};
}

function createClipEditorState({
	source,
	range,
	settings,
	headingsEnabled,
}: {
	source: MediaAsset;
	range: { sourceStartMs: number; sourceEndMs: number };
	settings: TProjectSettings;
	headingsEnabled: boolean;
}): LocalClipEditorStateV1 {
	const scene = buildDefaultScene({ name: "Main scene", isMain: true });
	const sourceDuration = mediaTimeFromSeconds({
		seconds: source.duration ?? range.sourceEndMs / 1000,
	});
	const duration = mediaTimeFromSeconds({
		seconds: (range.sourceEndMs - range.sourceStartMs) / 1000,
	});
	const video = buildElementFromMedia({
		mediaId: source.id,
		mediaType: "video",
		name: source.name,
		duration: sourceDuration,
		startTime: ZERO_MEDIA_TIME,
	});
	if (video.type !== "video")
		throw new Error("The local clip source must be a video.");
	scene.tracks.main.elements = [
		{
			...video,
			id: generateUUID(),
			duration,
			trimStart: mediaTimeFromSeconds({ seconds: range.sourceStartMs / 1000 }),
			trimEnd: mediaTimeFromSeconds({
				seconds:
					(Math.round((source.duration ?? 0) * 1000) - range.sourceEndMs) /
					1000,
			}),
			sourceDuration,
		} satisfies VideoElement,
	];
	if (headingsEnabled) {
		const heading = buildTextElement({
			raw: {
				name: "Heading",
				duration,
				params: {
					content: "Add a heading",
					fontSize: 64,
					fontWeight: "bold",
					textAlign: "center",
					color: "#ffffff",
					"transform.positionY": -Math.round(settings.canvasSize.height * 0.3),
				},
			},
			startTime: ZERO_MEDIA_TIME,
		});
		if (heading.type !== "text") throw new Error("Heading creation failed.");
		const track: TextTrack = {
			id: generateUUID(),
			name: "Heading",
			type: "text",
			hidden: false,
			elements: [{ ...heading, id: generateUUID() } satisfies TextElement],
		};
		scene.tracks.overlay.push(track);
	}
	return {
		scenes: [scene],
		currentSceneId: scene.id,
		settings,
		capinstaCaptionDocuments: [],
	};
}
