import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { EditorCore as EditorCoreType } from "@/core";
import type { TProject } from "@/project/types";
import type {
	GraphicTrack,
	MotionTemplateElement,
	SceneTracks,
	TScene,
} from "@/timeline";

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
	getCompositorCanvas: () =>
		typeof document === "undefined" ? null : document.createElement("canvas"),
	resizeCompositor: () => undefined,
	uploadTexture: () => undefined,
	releaseTexture: () => undefined,
	renderFrame: () => undefined,
	getLastFrameProfile: () => [],
	ZERO_MEDIA_TIME: 0,
}));

const ticks = ({ seconds }: { seconds: number }) => seconds * 120_000;

describe("motion template history integration", () => {
	beforeEach(async () => {
		const { EditorCore } = await import("@/core");
		EditorCore.reset();
	});

	test("insert, update, delete, undo and redo use the real command manager", async () => {
		const { editor, trackId } = await setupEditor();
		const { getTemplateDefinition } = await import("@/templates");
		const { buildMotionTemplateElement } =
			await import("@/timeline/element-utils");
		const definition = getTemplateDefinition({ templateId: "position-dance" });

		editor.timeline.insertElement({
			element: buildMotionTemplateElement({
				templateId: definition.id,
				startTime: 0,
				frameRatio: "16:9",
			}),
			placement: { mode: "explicit", trackId },
		});

		const inserted = getOnlyTemplate({ editor, trackId });
		expect(inserted.templateId).toBe("position-dance");
		expect(inserted.templateParams.frameRatio).toBe("16:9");
		expect(editor.command.canUndo()).toBe(true);

		editor.command.undo();
		expect(getTemplates({ editor, trackId })).toHaveLength(0);
		expect(editor.command.canRedo()).toBe(true);

		editor.command.redo();
		const restored = getOnlyTemplate({ editor, trackId });
		expect(restored.templateId).toBe("position-dance");

		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: restored.id,
					patch: {
						templateParams: {
							...restored.templateParams,
							background: "#abcdef",
							cardSize: 0.42,
						},
					},
				},
			],
		});
		expect(getOnlyTemplate({ editor, trackId }).templateParams.background).toBe(
			"#abcdef",
		);

		editor.command.undo();
		expect(getOnlyTemplate({ editor, trackId }).templateParams.background).toBe(
			definition.defaults.background,
		);

		editor.command.redo();
		expect(getOnlyTemplate({ editor, trackId }).templateParams.cardSize).toBe(
			0.42,
		);

		editor.timeline.deleteElements({
			elements: [{ trackId, elementId: restored.id }],
		});
		expect(getTemplates({ editor, trackId })).toHaveLength(0);

		editor.command.undo();
		expect(getTemplates({ editor, trackId })).toHaveLength(1);

		editor.command.redo();
		expect(getTemplates({ editor, trackId })).toHaveLength(0);
	});

	test("media, crop, ordering, reset and replacement patches undo and redo", async () => {
		const { editor, trackId } = await setupEditor();
		const { getTemplateDefinition, normalizeTemplateSlotOrder } =
			await import("@/templates");
		const { buildReplaceTemplatePatch, buildResetTemplatePatch } =
			await import("@/templates/instance-actions");
		const element = await insertPositionDance({ editor, trackId });
		const definition = getTemplateDefinition({
			templateId: element.templateId,
		});
		const boundSlot = {
			mediaId: "video-1",
			fit: "contain" as const,
			crop: { x: 0.25, y: -0.2, scale: 1.8 },
			playbackMode: "freeze" as const,
			sourceStart: ticks({ seconds: 1 }),
			sourceEnd: ticks({ seconds: 3 }),
		};

		patchElement({
			editor,
			trackId,
			elementId: element.id,
			patch: {
				slotBindings: {
					...element.slotBindings,
					"slot-1": boundSlot,
				},
			},
		});
		expect(getOnlyTemplate({ editor, trackId }).slotBindings["slot-1"]).toEqual(
			boundSlot,
		);
		editor.command.undo();
		expect(
			getOnlyTemplate({ editor, trackId }).slotBindings["slot-1"],
		).toBeNull();
		editor.command.redo();
		expect(getOnlyTemplate({ editor, trackId }).slotBindings["slot-1"]).toEqual(
			boundSlot,
		);

		const withBinding = getOnlyTemplate({ editor, trackId });
		const reordered = [
			"slot-3",
			"slot-1",
			"slot-2",
			"slot-4",
			"slot-5",
			"slot-6",
		];
		patchElement({
			editor,
			trackId,
			elementId: withBinding.id,
			patch: { slotOrder: reordered },
		});
		expect(getOnlyTemplate({ editor, trackId }).slotOrder).toEqual(reordered);
		editor.command.undo();
		expect(getOnlyTemplate({ editor, trackId }).slotOrder).toEqual(
			normalizeTemplateSlotOrder({ definition }),
		);
		editor.command.redo();
		expect(getOnlyTemplate({ editor, trackId }).slotBindings["slot-1"]).toEqual(
			boundSlot,
		);

		const beforeReset = getOnlyTemplate({ editor, trackId });
		patchElement({
			editor,
			trackId,
			elementId: beforeReset.id,
			patch: buildResetTemplatePatch({ definition, includeMedia: false }),
		});
		expect(getOnlyTemplate({ editor, trackId }).templateParams).toEqual(
			definition.defaults,
		);
		expect(getOnlyTemplate({ editor, trackId }).slotBindings["slot-1"]).toEqual(
			boundSlot,
		);
		editor.command.undo();
		expect(getOnlyTemplate({ editor, trackId }).slotOrder).toEqual(reordered);
		editor.command.redo();

		const replacementPatch = buildReplaceTemplatePatch({
			element: getOnlyTemplate({ editor, trackId }),
			sourceDefinition: definition,
			destinationTemplateId: "carousel-flow",
		});
		expect(replacementPatch).not.toBeNull();
		patchElement({
			editor,
			trackId,
			elementId: getOnlyTemplate({ editor, trackId }).id,
			patch: replacementPatch ?? {},
		});
		expect(getOnlyTemplate({ editor, trackId }).templateId).toBe(
			"carousel-flow",
		);
		editor.command.undo();
		expect(getOnlyTemplate({ editor, trackId }).templateId).toBe(
			"position-dance",
		);
		editor.command.redo();
		expect(getOnlyTemplate({ editor, trackId }).templateId).toBe(
			"carousel-flow",
		);
	});

	test("preview updates group multiple gesture changes into one undo entry", async () => {
		const { editor, trackId } = await setupEditor();
		const element = await insertPositionDance({ editor, trackId });
		editor.command.clear();

		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: {
						templateParams: { ...element.templateParams, cardSize: 0.3 },
					},
				},
			],
		});
		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: {
						templateParams: { ...element.templateParams, cardSize: 0.45 },
					},
				},
			],
		});
		expect(editor.command.canUndo()).toBe(false);

		editor.timeline.commitPreview();
		expect(editor.command.canUndo()).toBe(true);
		expect(getOnlyTemplate({ editor, trackId }).templateParams.cardSize).toBe(
			0.45,
		);

		editor.command.undo();
		expect(getOnlyTemplate({ editor, trackId }).templateParams.cardSize).toBe(
			element.templateParams.cardSize,
		);
		expect(editor.command.canUndo()).toBe(false);

		editor.command.redo();
		expect(getOnlyTemplate({ editor, trackId }).templateParams.cardSize).toBe(
			0.45,
		);
	});
});

async function setupEditor(): Promise<{
	editor: EditorCoreType;
	trackId: string;
}> {
	const { EditorCore } = await import("@/core");
	const editor = EditorCore.getInstance();
	const trackId = "graphic-track";
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
			name: "Template history",
			duration: 0,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		},
		scenes: [scene],
		currentSceneId: scene.id,
		settings: {
			fps: { num: 30, den: 1 },
			canvasSize: { width: 1080, height: 1080 },
			canvasSizeMode: "preset",
			lastCustomCanvasSize: null,
			originalCanvasSize: null,
			background: { type: "color", color: "transparent" },
		},
		version: 32,
	};
	editor.project.setActiveProject({ project });
	editor.scenes.initializeScenes({
		scenes: [scene],
		currentSceneId: scene.id,
	});
	editor.command.clear();
	return { editor, trackId };
}

function buildTracks({ trackId }: { trackId: string }): SceneTracks {
	return {
		main: {
			id: "main-track",
			name: "Main",
			type: "video",
			elements: [],
			muted: false,
			hidden: false,
		},
		overlay: [
			{
				id: trackId,
				name: "Graphic",
				type: "graphic",
				elements: [],
				hidden: false,
			},
		],
		audio: [],
	};
}

async function insertPositionDance({
	editor,
	trackId,
}: {
	editor: EditorCoreType;
	trackId: string;
}): Promise<MotionTemplateElement> {
	const { getTemplateDefinition } = await import("@/templates");
	const { buildMotionTemplateElement } =
		await import("@/timeline/element-utils");
	const definition = getTemplateDefinition({ templateId: "position-dance" });
	editor.timeline.insertElement({
		element: buildMotionTemplateElement({
			templateId: definition.id,
			startTime: 0,
		}),
		placement: { mode: "explicit", trackId },
	});
	return getOnlyTemplate({ editor, trackId });
}

function patchElement({
	editor,
	trackId,
	elementId,
	patch,
}: {
	editor: EditorCoreType;
	trackId: string;
	elementId: string;
	patch: Partial<MotionTemplateElement>;
}): void {
	editor.timeline.updateElements({
		updates: [{ trackId, elementId, patch }],
	});
}

function getTemplates({
	editor,
	trackId,
}: {
	editor: EditorCoreType;
	trackId: string;
}): MotionTemplateElement[] {
	const track = editor.timeline.getTrackById({
		trackId,
	}) as GraphicTrack | null;
	return (
		track?.elements.filter(
			(element): element is MotionTemplateElement =>
				element.type === "motion-template",
		) ?? []
	);
}

function getOnlyTemplate({
	editor,
	trackId,
}: {
	editor: EditorCoreType;
	trackId: string;
}): MotionTemplateElement {
	const templates = getTemplates({ editor, trackId });
	expect(templates).toHaveLength(1);
	return templates[0];
}
