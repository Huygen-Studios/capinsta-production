import { describe, expect, mock, test } from "bun:test";

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
}));

const ticks = ({ seconds }: { seconds: number }) => seconds * 120_000;
const requiredTemplateIds = [
	"position-dance",
	"showcase-stream",
	"ticker-loop",
	"cascade-drop",
] as const;

describe("motion template preview/export scene parity inputs", () => {
	test("scene builder creates equivalent motion-template nodes for preview and export", async () => {
		const { buildScene } = await import("@/services/renderer/scene-builder");
		const { MotionTemplateNode } =
			await import("@/services/renderer/nodes/motion-template-node");
		const {
			evaluateTemplateScene,
			getTemplateDefinition,
			resolveTemplateVideoSourceTimeSeconds,
		} = await import("@/templates");

		for (const templateId of requiredTemplateIds) {
			const definition = getTemplateDefinition({ templateId });
			const cycleDuration = 4;
			const element = {
				id: `template-${templateId}`,
				type: "motion-template" as const,
				name: definition.name,
				templateId: definition.id,
				templateVersion: definition.version,
				duration: ticks({ seconds: definition.defaultDuration }),
				startTime: 0,
				trimStart: 0,
				trimEnd: 0,
				params: {},
				slotOrder: definition.mediaSlots.map((slot) => slot.id).toReversed(),
				slotBindings: Object.fromEntries(
					definition.mediaSlots.map((slot, index) => [
						slot.id,
						{
							mediaId: index % 2 === 0 ? "video-1" : "image-1",
							fit: index % 3 === 0 ? "contain" : "cover",
							crop: {
								x: 0.1 * index,
								y: -0.05 * index,
								scale: 1 + index * 0.1,
							},
							playbackMode: index % 2 === 0 ? "loop" : "freeze",
							sourceStart: ticks({ seconds: 1 }),
							sourceEnd: ticks({ seconds: 3 }),
						},
					]),
				),
				templateParams: {
					...definition.defaults,
					cycleDuration,
					frameRatio: "4:5",
					cardRatio: "16:9",
					background: "#112233",
					padding: 0.12,
					cornerRadius: 0.2,
					shadowEnabled: true,
					shadowColor: "#000000",
					shadowOpacity: 0.4,
					shadowBlur: 16,
					shadowOffsetX: 4,
					shadowOffsetY: 8,
					easing: "snappy",
					rotationAmount: 16,
				},
			};
			const tracks = {
				main: {
					id: "main",
					name: "Main",
					type: "video" as const,
					elements: [],
					muted: false,
					hidden: false,
				},
				overlay: [
					{
						id: "graphic-1",
						name: "Graphic",
						type: "graphic" as const,
						elements: [element],
						hidden: false,
					},
				],
				audio: [],
			};
			const common = {
				canvasSize: { width: 1080, height: 1350 },
				tracks,
				mediaAssets: [
					{
						id: "image-1",
						name: "image.png",
						type: "image" as const,
						mimeType: "image/png",
						file: new File(["image"], "image.png", { type: "image/png" }),
						url: "blob:image",
					},
					{
						id: "video-1",
						name: "video.mp4",
						type: "video" as const,
						mimeType: "video/mp4",
						file: new File(["video"], "video.mp4", { type: "video/mp4" }),
						url: "blob:video",
						duration: 5,
					},
				],
				duration: element.duration,
				background: { type: "color" as const, color: "transparent" },
			};

			const preview = buildScene({ ...common, isPreview: true });
			const exported = buildScene({ ...common, isPreview: false });
			const previewNode = preview.children.find(
				(node) => node instanceof MotionTemplateNode,
			);
			const exportNode = exported.children.find(
				(node) => node instanceof MotionTemplateNode,
			);
			expect(previewNode).toBeInstanceOf(MotionTemplateNode);
			expect(exportNode).toBeInstanceOf(MotionTemplateNode);
			if (
				!(previewNode instanceof MotionTemplateNode) ||
				!(exportNode instanceof MotionTemplateNode)
			) {
				continue;
			}
			expect(previewNode.params.element).toEqual(exportNode.params.element);
			expect(previewNode.params.duration).toBe(exportNode.params.duration);
			expect(previewNode.params.timeOffset).toBe(exportNode.params.timeOffset);
			expect(previewNode.params.mediaAssets).toEqual(
				exportNode.params.mediaAssets,
			);

			for (const time of [
				0,
				cycleDuration * 0.25,
				cycleDuration * 0.5,
				cycleDuration * 0.75,
				cycleDuration - 0.001,
				cycleDuration,
				cycleDuration + 0.001,
			]) {
				const previewScene = evaluateTemplateScene({
					element: previewNode.params.element,
					localTime: time,
					durationSeconds: previewNode.params.duration / ticks({ seconds: 1 }),
				});
				const exportScene = evaluateTemplateScene({
					element: exportNode.params.element,
					localTime: time,
					durationSeconds: exportNode.params.duration / ticks({ seconds: 1 }),
				});
				expect(exportScene).toEqual(previewScene);
				expect(previewScene.every((layer) => Number.isFinite(layer.x))).toBe(
					true,
				);
				const firstVideoBinding =
					previewNode.params.element.slotBindings[
						previewNode.params.element.slotOrder?.[0] ?? "slot-1"
					];
				if (firstVideoBinding?.mediaId === "video-1") {
					expect(
						resolveTemplateVideoSourceTimeSeconds({
							binding: firstVideoBinding,
							assetDurationSeconds: 5,
							localTimeSeconds: time,
						}),
					).toBe(
						resolveTemplateVideoSourceTimeSeconds({
							binding: firstVideoBinding,
							assetDurationSeconds: 5,
							localTimeSeconds: time,
						}),
					);
				}
			}
		}
	});
});
