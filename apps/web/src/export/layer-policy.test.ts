import { describe, expect, mock, test } from "bun:test";
import type { SceneTracks } from "@/timeline";
import { resolveExportSceneBackground } from "./color";
import {
	applyExportLayerPolicy,
	exportLayerPolicyForMode,
	hasIndependentVisualLayers,
} from "./layer-policy";

mock.module("opencut-wasm", () => ({
	TICKS_PER_SECOND: () => 120_000,
	lastFrameTime: ({ duration }: { duration: number }) => duration,
	mediaTimeFromSeconds: ({ seconds }: { seconds: number }) =>
		Math.round(seconds * 120_000),
	mediaTimeToSeconds: ({ time }: { time: number }) => time / 120_000,
	parseTimecode: () => null,
	roundToFrame: ({ time }: { time: number }) => Math.round(time),
	roundMediaTime: ({ time }: { time: number }) => Math.round(time),
	snappedSeekTime: ({ time }: { time: number }) => Math.round(time),
	ZERO_MEDIA_TIME: 0,
}));

const ZERO_MEDIA_TIME = 0;

const baseElement = {
	duration: ZERO_MEDIA_TIME,
	startTime: ZERO_MEDIA_TIME,
	trimStart: ZERO_MEDIA_TIME,
	trimEnd: ZERO_MEDIA_TIME,
	params: {},
};

const tracks: SceneTracks = {
	main: {
		id: "main",
		name: "Main",
		type: "video",
		muted: false,
		hidden: false,
		elements: [
			{
				...baseElement,
				id: "video",
				name: "Video",
				type: "video",
				mediaId: "video-media",
			},
		],
	},
	overlay: [
		{
			id: "media-overlay",
			name: "Media",
			type: "video",
			muted: false,
			hidden: false,
			elements: [
				{
					...baseElement,
					id: "image",
					name: "Image",
					type: "image",
					mediaId: "image-media",
				},
			],
		},
		{
			id: "graphics",
			name: "Graphics",
			type: "graphic",
			hidden: false,
			elements: [
				{
					...baseElement,
					id: "template",
					name: "Template",
					type: "motion-template",
					templateId: "position-dance",
					templateVersion: 1,
					templateParams: {},
					slotBindings: {},
				},
			],
		},
	],
	audio: [],
};

describe("export layer policy", () => {
	test("full video keeps the complete timeline", () => {
		const result = applyExportLayerPolicy({
			tracks,
			policy: exportLayerPolicyForMode({ exportMode: "full_video" }),
		});
		expect(result).toBe(tracks);
	});

	test("graphics layer removes ordinary media and keeps templates", () => {
		const result = applyExportLayerPolicy({
			tracks,
			policy: exportLayerPolicyForMode({
				exportMode: "captions_solid_background",
			}),
		});
		expect(result.main.elements).toEqual([]);
		expect(result.overlay[0]?.elements).toEqual([]);
		expect(result.overlay[1]?.elements).toHaveLength(1);
		expect(hasIndependentVisualLayers({ tracks: result })).toBe(true);
	});

	test("builds an opaque green root behind retained graphics", async () => {
		const { buildScene } = await import("@/services/renderer/scene-builder");
		const { ColorNode } = await import("@/services/renderer/nodes/color-node");
		const { MotionTemplateNode } =
			await import("@/services/renderer/nodes/motion-template-node");
		const filtered = applyExportLayerPolicy({
			tracks,
			policy: "overlay-layers-on-solid-background",
		});
		const scene = buildScene({
			canvasSize: { width: 64, height: 64 },
			tracks: filtered,
			mediaAssets: [],
			duration: ZERO_MEDIA_TIME,
			background: resolveExportSceneBackground({
				exportMode: "captions_solid_background",
				requestedColor: "#00FF00",
				projectBackground: { type: "color", color: "#101014" },
			}),
		});
		const colorNode = scene.children[0];
		expect(colorNode).toBeInstanceOf(ColorNode);
		if (!(colorNode instanceof ColorNode)) return;
		expect(colorNode.params.color).toBe("#00FF00");
		expect(
			scene.children.some((node) => node instanceof MotionTemplateNode),
		).toBe(true);
	});
});
