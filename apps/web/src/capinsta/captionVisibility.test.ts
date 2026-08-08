import { describe, expect, test } from "bun:test";
import {
	getVisibleCapinstaCaptionRecords,
	isCapinstaCaptionRecordVisible,
} from "./captionVisibility";
import type { CapinstaCaptionDocumentRecord } from "./types";
import type { SceneTracks } from "@/timeline";

const record = {
	openCutTrackId: "captions",
	importedAt: "2026-06-21T00:00:00.000Z",
	document: { id: "document" },
} as CapinstaCaptionDocumentRecord;

function tracks(hidden: boolean): SceneTracks {
	return {
		main: {
			id: "main",
			name: "Main",
			type: "video",
			hidden: false,
			muted: false,
			elements: [],
		},
		audio: [],
		overlay: [
			{
				id: "captions",
				name: "Captions",
				type: "text",
				hidden,
				elements: [],
			},
		],
	};
}

describe("Capinsta caption visibility", () => {
	test("uses the persisted timeline track hidden property", () => {
		expect(
			isCapinstaCaptionRecordVisible({ record, tracks: tracks(false) }),
		).toBe(true);
		expect(
			isCapinstaCaptionRecordVisible({ record, tracks: tracks(true) }),
		).toBe(false);
	});

	test("full-video selection excludes hidden captions without deleting data", () => {
		expect(
			getVisibleCapinstaCaptionRecords({
				records: [record],
				tracks: tracks(true),
			}),
		).toEqual([]);
		expect(record.openCutTrackId).toBe("captions");
	});

	test("captions-only selection explicitly includes hidden captions", () => {
		expect(
			getVisibleCapinstaCaptionRecords({
				records: [record],
				tracks: tracks(true),
				includeHidden: true,
			}),
		).toEqual([record]);
	});
});
