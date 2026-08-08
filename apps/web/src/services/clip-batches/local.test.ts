/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- MediaTime is nominal. */
import { describe, expect, test } from "bun:test";
import * as local from "./local";

function project() {
	const now = new Date();
	return {
		metadata: {
			id: "project-1",
			name: "Local clips",
			duration: 0 as never,
			createdAt: now,
			updatedAt: now,
		},
		scenes: [],
		currentSceneId: "",
		settings: {
			fps: { numerator: 30, denominator: 1 },
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color" as const, color: "#000000" },
		},
		version: 1,
	};
}

function ranges({
	duration,
	count,
	maximum,
}: {
	duration: number;
	count: number;
	maximum: number;
}) {
	const slot = duration / count;
	const length = Math.min(maximum, Math.floor(slot));
	return Array.from({ length: count }, (_, index) => ({
		sourceStartMs: Math.floor(index * slot),
		sourceEndMs: Math.floor(index * slot) + length,
	}));
}

describe("local clipping batch", () => {
	test("five clips share one source while keeping independent editor state", () => {
		const batch = local.createLocalClipBatch({
			project: project(),
			source: {
				id: "source-1",
				name: "source.mp4",
				type: "video",
				file: new File(["video"], "source.mp4", { type: "video/mp4" }),
				url: "blob:source",
				duration: 600,
			},
			ranges: ranges({ duration: 600_000, count: 5, maximum: 180_000 }),
			maximumClipDurationMs: 180_000,
			platformPreset: "instagram_reels",
			captionsEnabled: false,
			headingsEnabled: true,
		});
		expect(batch.items).toHaveLength(5);
		expect(
			batch.items.every(
				(item) => item.sourceEndMs - item.sourceStartMs <= 180_000,
			),
		).toBe(true);
		expect(
			new Set(
				batch.items.flatMap((item) =>
					item.editorProjectState.scenes.flatMap((scene) =>
						scene.tracks.main.elements.map((element) => element.mediaId),
					),
				),
			),
		).toEqual(new Set(["source-1"]));
		const duplicate = local.duplicateLocalClip(batch, batch.items[0]!.id);
		expect(duplicate.items).toHaveLength(6);
		duplicate.items.at(
			-1,
		)!.editorProjectState.scenes[0]!.tracks.overlay[0]!.elements[0]!.params.content =
			"Independent";
		expect(
			batch.items[0]!.editorProjectState.scenes[0]!.tracks.overlay[0]!
				.elements[0]!.params.content,
		).toBe("Add a heading");
	});

	test("reordering changes output order without changing timing", () => {
		const batch = local.createLocalClipBatch({
			project: project(),
			source: {
				id: "source-1",
				name: "source.mp4",
				type: "video",
				file: new File(["video"], "source.mp4"),
				url: "blob:source",
				duration: 60,
			},
			ranges: ranges({ duration: 60_000, count: 5, maximum: 10_000 }),
			maximumClipDurationMs: 10_000,
			platformPreset: "custom",
			captionsEnabled: false,
			headingsEnabled: false,
		});
		const timing = batch.items.map(({ id, sourceStartMs, sourceEndMs }) => ({
			id,
			sourceStartMs,
			sourceEndMs,
		}));
		const moved = local.reorderLocalClip(batch, batch.clipOrder[0]!, 1);
		expect(moved.clipOrder.slice(0, 2)).toEqual(
			batch.clipOrder.slice(0, 2).reverse(),
		);
		expect(
			moved.items.map(({ id, sourceStartMs, sourceEndMs }) => ({
				id,
				sourceStartMs,
				sourceEndMs,
			})),
		).toEqual(timing);
	});
});
