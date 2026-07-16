import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { EditorCore as EditorCoreType } from "@/core";
import type { TProject } from "@/project/types";
import type { ImageElement, SceneTracks, TScene, VideoTrack } from "@/timeline";

mock.module("opencut-wasm", () => ({
	TICKS_PER_SECOND: () => 120_000,
	lastFrameMediaTime: ({ duration }: { duration: number }) => duration,
	lastFrameTime: ({ duration }: { duration: number }) => duration,
	mediaTimeFromSeconds: ({ seconds }: { seconds: number }) =>
		Math.round(seconds * 120_000),
	mediaTimeToSeconds: ({ time }: { time: number }) => time / 120_000,
	parseTimecode: () => null,
	roundToFrame: ({ time }: { time: number }) => Math.round(time),
	roundMediaTime: ({ time }: { time: number }) => Math.round(time),
	snappedSeekTime: ({ time }: { time: number }) => Math.round(time),
	formatTimecode: () => "00:00:00:00",
	initializeGpu: async () => undefined,
	applyEffectPasses: ({ source }: { source: OffscreenCanvas }) => source,
	applyMaskFeather: ({ mask }: { mask: OffscreenCanvas }) => mask,
	initCompositor: () => undefined,
	getCompositorCanvas: () => null,
	resizeCompositor: () => undefined,
	uploadTexture: () => undefined,
	releaseTexture: () => undefined,
	renderFrame: () => undefined,
	getLastFrameProfile: () => [],
	ZERO_MEDIA_TIME: 0,
}));

describe("3D motion history integration", () => {
	beforeEach(async () => {
		const { EditorCore } = await import("@/core");
		EditorCore.reset();
	});

	test("apply, edit, replace, reset and remove are undoable and redoable", async () => {
		const { editor, trackId, elementId } = await setupEditor();
		const { createLayer3DEffect } = await import("@/layer-3d");
		const initial = getImage({ editor, trackId, elementId });
		expect(initial.layer3DEffect).toBeUndefined();

		const applied = createLayer3DEffect({ presetId: "cinematic-push" });
		patchEffect({ editor, trackId, elementId, effect: applied });
		expect(
			getImage({ editor, trackId, elementId }).layer3DEffect?.presetId,
		).toBe("cinematic-push");
		assertUndoRedo({
			editor,
			trackId,
			elementId,
			before: undefined,
			after: applied,
		});

		const beforeEdit = getImage({ editor, trackId, elementId }).layer3DEffect;
		const edited = {
			...requireEffect({ effect: beforeEdit }),
			transform: {
				...requireEffect({ effect: beforeEdit }).transform,
				positionZ: 275,
				anchorZ: 28,
				scaleZ: 130,
				rotationY: 18,
			},
		};
		patchEffect({ editor, trackId, elementId, effect: edited });
		assertUndoRedo({
			editor,
			trackId,
			elementId,
			before: beforeEdit,
			after: edited,
		});

		const replacement = createLayer3DEffect({ presetId: "light-sweep-hero" });
		patchEffect({ editor, trackId, elementId, effect: replacement });
		assertUndoRedo({
			editor,
			trackId,
			elementId,
			before: edited,
			after: replacement,
		});

		const reset = createLayer3DEffect({ presetId: replacement.presetId });
		patchEffect({ editor, trackId, elementId, effect: reset });
		assertUndoRedo({
			editor,
			trackId,
			elementId,
			before: replacement,
			after: reset,
		});

		patchEffect({ editor, trackId, elementId, effect: undefined });
		assertUndoRedo({
			editor,
			trackId,
			elementId,
			before: reset,
			after: undefined,
		});
	});

	test("multiple slider previews commit as one history entry", async () => {
		const { editor, trackId, elementId } = await setupEditor();
		const { createLayer3DEffect } = await import("@/layer-3d");
		const effect = createLayer3DEffect({ presetId: "floating-poster" });
		patchEffect({ editor, trackId, elementId, effect });
		editor.command.clear();

		for (const positionZ of [20, 80, 160, 240]) {
			editor.timeline.previewElements({
				updates: [
					{
						trackId,
						elementId,
						updates: {
							layer3DEffect: {
								...effect,
								transform: { ...effect.transform, positionZ },
							},
						},
					},
				],
			});
		}
		expect(editor.command.canUndo()).toBe(false);
		editor.timeline.commitPreview();
		expect(
			getImage({ editor, trackId, elementId }).layer3DEffect?.transform
				.positionZ,
		).toBe(240);
		editor.command.undo();
		expect(
			getImage({ editor, trackId, elementId }).layer3DEffect?.transform
				.positionZ,
		).toBe(0);
		expect(editor.command.canUndo()).toBe(false);
		editor.command.redo();
		expect(
			getImage({ editor, trackId, elementId }).layer3DEffect?.transform
				.positionZ,
		).toBe(240);
	});
});

async function setupEditor(): Promise<{
	editor: EditorCoreType;
	trackId: string;
	elementId: string;
}> {
	const { EditorCore } = await import("@/core");
	const { buildElementFromMedia } = await import("@/timeline/element-utils");
	const { mediaTimeFromSeconds } = await import("@/wasm");
	const editor = EditorCore.getInstance();
	const trackId = "main-track";
	const scene: TScene = {
		id: "scene-1",
		name: "Main scene",
		isMain: true,
		tracks: buildTracks({ trackId }),
		bookmarks: [],
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	};
	const project: TProject = {
		metadata: {
			id: "project-1",
			name: "3D history",
			duration: 0,
			createdAt: scene.createdAt,
			updatedAt: scene.updatedAt,
		},
		scenes: [scene],
		currentSceneId: scene.id,
		settings: {
			fps: { num: 30, den: 1 },
			canvasSize: { width: 1280, height: 720 },
			canvasSizeMode: "preset",
			lastCustomCanvasSize: null,
			originalCanvasSize: null,
			background: { type: "color", color: "transparent" },
		},
		version: 34,
	};
	editor.project.setActiveProject({ project });
	editor.scenes.initializeScenes({ scenes: [scene], currentSceneId: scene.id });
	const element = buildElementFromMedia({
		mediaId: "image-1",
		mediaType: "image",
		name: "Poster",
		duration: mediaTimeFromSeconds({ seconds: 5 }),
		startTime: mediaTimeFromSeconds({ seconds: 0 }),
	});
	editor.timeline.insertElement({
		element,
		placement: { mode: "explicit", trackId },
	});
	const image = getImages({ editor, trackId })[0];
	if (!image) throw new Error("Image insertion failed");
	editor.command.clear();
	return { editor, trackId, elementId: image.id };
}

function buildTracks({ trackId }: { trackId: string }): SceneTracks {
	return {
		main: {
			id: trackId,
			name: "Main",
			type: "video",
			elements: [],
			muted: false,
			hidden: false,
		},
		overlay: [],
		audio: [],
	};
}

function getImages({
	editor,
	trackId,
}: {
	editor: EditorCoreType;
	trackId: string;
}): ImageElement[] {
	const track = editor.timeline.getTrackById({ trackId }) as VideoTrack | null;
	return (
		track?.elements.filter(
			(element): element is ImageElement => element.type === "image",
		) ?? []
	);
}

function getImage({
	editor,
	trackId,
	elementId,
}: {
	editor: EditorCoreType;
	trackId: string;
	elementId: string;
}): ImageElement {
	const image = getImages({ editor, trackId }).find(
		(element) => element.id === elementId,
	);
	if (!image) throw new Error("Expected image element");
	return image;
}

function patchEffect({
	editor,
	trackId,
	elementId,
	effect,
}: {
	editor: EditorCoreType;
	trackId: string;
	elementId: string;
	effect: ImageElement["layer3DEffect"];
}): void {
	editor.timeline.updateElements({
		updates: [{ trackId, elementId, patch: { layer3DEffect: effect } }],
	});
}

function requireEffect({
	effect,
}: {
	effect: ImageElement["layer3DEffect"];
}): NonNullable<ImageElement["layer3DEffect"]> {
	if (!effect) throw new Error("Expected 3D effect");
	return effect;
}

function assertUndoRedo({
	editor,
	trackId,
	elementId,
	before,
	after,
}: {
	editor: EditorCoreType;
	trackId: string;
	elementId: string;
	before: ImageElement["layer3DEffect"];
	after: ImageElement["layer3DEffect"];
}): void {
	editor.command.undo();
	expect(getImage({ editor, trackId, elementId }).layer3DEffect).toEqual(
		before,
	);
	editor.command.redo();
	expect(getImage({ editor, trackId, elementId }).layer3DEffect).toEqual(after);
}
