import { describe, expect, mock, test } from "bun:test";
import type { LocalClipBatchV1, LocalClipItemV1 } from "@/project/types";

mock.module("opencut-wasm", () => ({
	sanitizeLocalClipFilename: (title: string) =>
		title.trim().replaceAll(" ", "-"),
}));

const { buildLocalClipExportQueue } = await import("./local-export");

function batch(): LocalClipBatchV1 {
	const items = Array.from({ length: 5 }, (_, index) => ({
		schemaVersion: 1,
		id: `clip-${index + 1}`,
		ordinal: index + 1,
		title: `Clip ${index + 1}`,
		sourceStartMs: index * 10_000,
		sourceEndMs: (index + 1) * 10_000,
		selectedForExport: index > 0,
		captionsEnabled: false,
		headingEnabled: false,
		captionStatus: "idle",
		exportStatus: "idle",
		editorProjectState: {
			scenes: [],
			currentSceneId: "",
			settings: {
				fps: { numerator: 30, denominator: 1 },
				canvasSize: { width: 1080, height: 1920 },
				background: { type: "color", color: "#000000" },
			},
		},
		createdAt: "2026-08-04T00:00:00.000Z",
		updatedAt: "2026-08-04T00:00:00.000Z",
	})) satisfies LocalClipItemV1[];
	return {
		schemaVersion: 1,
		id: "batch-1",
		title: "Five clips",
		sourceMediaId: "source-1",
		sourceFileName: "source.mp4",
		sourceDurationMs: 60_000,
		sourceMimeType: "video/mp4",
		platformPreset: "instagram_reels",
		aspectRatio: { width: 1080, height: 1920 },
		captionsEnabled: false,
		headingsEnabled: false,
		maximumClipDurationMs: 180_000,
		clipOrder: items.map((item) => item.id),
		selectedClipId: items[0]!.id,
		normalEditorProjectState: items[0]!.editorProjectState,
		items,
		createdAt: "2026-08-04T00:00:00.000Z",
		updatedAt: "2026-08-04T00:00:00.000Z",
	};
}

describe("local clip export queue", () => {
	test("all includes Clip 1 and keeps ID, title, ordinal, and filename aligned", () => {
		const queue = buildLocalClipExportQueue({ batch: batch(), mode: "all" });
		expect(queue).toHaveLength(5);
		expect(queue.map(({ id }) => id)).toEqual([
			"clip-1",
			"clip-2",
			"clip-3",
			"clip-4",
			"clip-5",
		]);
		expect(queue.map(({ filename }) => filename)).toEqual([
			"clip-01-Clip-1.mp4",
			"clip-02-Clip-2.mp4",
			"clip-03-Clip-3.mp4",
			"clip-04-Clip-4.mp4",
			"clip-05-Clip-5.mp4",
		]);
	});

	test("selected and current use their explicit model invariants", () => {
		expect(
			buildLocalClipExportQueue({ batch: batch(), mode: "selected" }).map(
				({ id }) => id,
			),
		).toEqual(["clip-2", "clip-3", "clip-4", "clip-5"]);
		expect(
			buildLocalClipExportQueue({ batch: batch(), mode: "current" }).map(
				({ id }) => id,
			),
		).toEqual(["clip-1"]);
	});
});
