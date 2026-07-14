import { describe, expect, test } from "bun:test";
import { createLayer3DEffect } from "@/layer-3d";
import { transformProjectV32ToV33 } from "../transformers/v32-to-v33";

function projectWithElement({ element }: { element: Record<string, unknown> }) {
	return {
		id: "project-3d",
		version: 32,
		scenes: [
			{
				id: "scene",
				tracks: {
					main: { id: "main", type: "video", elements: [element] },
					overlay: [],
					audio: [],
				},
			},
		],
	};
}

describe("V32 to V33 migration", () => {
	test("preserves and normalizes a valid image 3D effect", () => {
		const effect = createLayer3DEffect({ presetId: "cinematic-push" });
		effect.transform.orientation = { x: 1, y: 2, z: 3, w: 4 };
		const result = transformProjectV32ToV33({
			project: projectWithElement({
				element: { id: "image", type: "image", layer3DEffect: effect },
			}),
		});
		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(33);
		expect(JSON.stringify(result.project.scenes)).toContain("cinematic-push");
	});

	test("removes malformed and unknown configurations without touching the element", () => {
		const result = transformProjectV32ToV33({
			project: projectWithElement({
				element: {
					id: "video",
					type: "video",
					mediaId: "media",
					layer3DEffect: { presetId: "missing" },
				},
			}),
		});
		expect(JSON.stringify(result.project)).not.toContain("layer3DEffect");
		expect(JSON.stringify(result.project)).toContain("media");
	});

	test("preserves a video effect and its source timing fields", () => {
		const effect = createLayer3DEffect({ presetId: "floating-poster" });
		const result = transformProjectV32ToV33({
			project: projectWithElement({
				element: {
					id: "video",
					type: "video",
					mediaId: "media-video",
					startTime: 240_000,
					trimStart: 120_000,
					trimEnd: 360_000,
					layer3DEffect: effect,
				},
			}),
		});
		const serialized = JSON.stringify(result.project);
		expect(serialized).toContain("floating-poster");
		expect(serialized).toContain("media-video");
		expect(serialized).toContain('"trimStart":120000');
		expect(serialized).toContain('"trimEnd":360000');
	});

	test("leaves old elements without 3D effects unchanged", () => {
		const project = projectWithElement({
			element: { id: "image", type: "image", mediaId: "media" },
		});
		const result = transformProjectV32ToV33({ project });
		expect(JSON.stringify(result.project)).toContain("media");
		expect(JSON.stringify(result.project)).not.toContain("layer3DEffect");
	});
});
