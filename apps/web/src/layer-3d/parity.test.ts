import { describe, expect, mock, test } from "bun:test";

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

describe("3D motion preview/export parity", () => {
	test("scene builders preserve identical effect inputs and evaluated states", async () => {
		const { createLayer3DEffect, evaluateLayer3DEffect } =
			await import("@/layer-3d");
		const { buildScene } = await import("@/services/renderer/scene-builder");
		const { ImageNode } = await import("@/services/renderer/nodes/image-node");
		const { mediaTimeFromSeconds } = await import("@/wasm");
		for (const presetId of [
			"cinematic-push",
			"floating-poster",
			"light-sweep-hero",
		] as const) {
			const effect = createLayer3DEffect({ presetId });
			effect.transform.anchorZ = 12;
			effect.transform.scaleZ = 118;
			effect.material.metallic = 42;
			const element = {
				id: `image-${presetId}`,
				type: "image" as const,
				name: "Poster",
				mediaId: "image-1",
				duration: mediaTimeFromSeconds({ seconds: 5 }),
				startTime: mediaTimeFromSeconds({ seconds: 0 }),
				trimStart: mediaTimeFromSeconds({ seconds: 0 }),
				trimEnd: mediaTimeFromSeconds({ seconds: 0 }),
				hidden: false,
				params: {},
				layer3DEffect: effect,
			};
			const common = {
				canvasSize: { width: 1280, height: 720 },
				tracks: {
					main: {
						id: "main",
						name: "Main",
						type: "video" as const,
						elements: [element],
						muted: false,
						hidden: false,
					},
					overlay: [],
					audio: [],
				},
				mediaAssets: [
					{
						id: "image-1",
						name: "poster.png",
						type: "image" as const,
						mimeType: "image/png",
						file: new File(["image"], "poster.png", { type: "image/png" }),
						url: "blob:image",
					},
				],
				duration: element.duration,
				background: { type: "color" as const, color: "transparent" },
			};
			const previewNode = buildScene({
				...common,
				isPreview: true,
			}).children.find((node) => node instanceof ImageNode);
			const exportNode = buildScene({
				...common,
				isPreview: false,
			}).children.find((node) => node instanceof ImageNode);
			expect(previewNode).toBeInstanceOf(ImageNode);
			expect(exportNode).toBeInstanceOf(ImageNode);
			if (
				!(previewNode instanceof ImageNode) ||
				!(exportNode instanceof ImageNode)
			)
				continue;
			expect(previewNode.params.layer3DEffect).toEqual(
				exportNode.params.layer3DEffect,
			);
			for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
				const localTimeSeconds = effect.animation.duration * fraction;
				const preview = evaluateLayer3DEffect({
					effect: previewNode.params.layer3DEffect!,
					localTimeSeconds,
					frame: common.canvasSize,
					layer: { width: 640, height: 360 },
				});
				const exported = evaluateLayer3DEffect({
					effect: exportNode.params.layer3DEffect!,
					localTimeSeconds,
					frame: common.canvasSize,
					layer: { width: 640, height: 360 },
				});
				expect(exported).toEqual(preview);
			}
		}
	});
});
