import { describe, expect, test } from "bun:test";
import {
	activeCapinstaCaptionStateKey,
	createCapinstaCaptionTimingIndex,
	getActiveCapinstaCaptionStateFromIndex,
} from "./captionTimingIndex";
import {
	capinstaTranscriptToCaptionDocument,
	updateCaptionClipTiming,
} from "./adapter";
import { sampleCapinstaTranscriptV1 } from "./sampleTranscript";
import type { CapinstaCaptionDocumentRecord } from "./types";

function buildRecord(): CapinstaCaptionDocumentRecord {
	return {
		document: capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1),
		openCutTrackId: "caption-track",
		importedAt: "2026-06-17T00:00:00.000Z",
	};
}

describe("Capinsta caption timing index", () => {
	test("returns the active clip with binary-search timing boundaries", () => {
		const record = buildRecord();
		const index = createCapinstaCaptionTimingIndex({ records: [record] });
		const firstClip = record.document.clips[0]!;

		expect(
			getActiveCapinstaCaptionStateFromIndex({
				index,
				timeSeconds: firstClip.start,
			})?.clip.id,
		).toBe(firstClip.id);
		expect(
			getActiveCapinstaCaptionStateFromIndex({
				index,
				timeSeconds: firstClip.end,
			})?.clip.id,
		).not.toBe(firstClip.id);
	});

	test("active word lookup keeps inclusive start and exclusive end", () => {
		const record = buildRecord();
		const index = createCapinstaCaptionTimingIndex({ records: [record] });
		const firstWord = record.document.words[0]!;

		expect(
			getActiveCapinstaCaptionStateFromIndex({
				index,
				timeSeconds: firstWord.start,
			})?.activeWordIds,
		).toEqual([firstWord.id]);
		expect(
			getActiveCapinstaCaptionStateFromIndex({
				index,
				timeSeconds: firstWord.end,
			})?.activeWordIds,
		).not.toContain(firstWord.id);
	});

	test("active word lookup stays empty when clip or word highlighting is disabled", () => {
		const record = buildRecord();
		const firstClip = record.document.clips[0]!;
		const firstWord = record.document.words[0]!;
		const index = createCapinstaCaptionTimingIndex({
			records: [
				{
					...record,
					document: {
						...record.document,
						clips: record.document.clips.map((clip) =>
							clip.id === firstClip.id
								? { ...clip, disableActiveWordHighlighting: true }
								: clip,
						),
						words: record.document.words.map((word) =>
							word.id === firstWord.id
								? { ...word, disableActiveWordHighlighting: true }
								: word,
						),
					},
				},
			],
		});

		expect(
			getActiveCapinstaCaptionStateFromIndex({
				index,
				timeSeconds: firstWord.start,
			})?.activeWordIds,
		).toEqual([]);
	});

	test("index updates when clip timings change", () => {
		const record = buildRecord();
		const originalClip = record.document.clips[0]!;
		const shiftedRecord: CapinstaCaptionDocumentRecord = {
			...record,
			document: updateCaptionClipTiming(
				record.document,
				originalClip.id,
				originalClip.start + 0.1,
				originalClip.end + 0.1,
			),
		};
		const index = createCapinstaCaptionTimingIndex({
			records: [shiftedRecord],
		});

		expect(
			getActiveCapinstaCaptionStateFromIndex({
				index,
				timeSeconds: record.document.clips[0]!.start,
			})?.clip.id,
		).not.toBe(record.document.clips[0]!.id);
		expect(
			getActiveCapinstaCaptionStateFromIndex({
				index,
				timeSeconds: shiftedRecord.document.clips[0]!.start,
			})?.clip.id,
		).toBe(shiftedRecord.document.clips[0]!.id);
	});

	test("state key changes only when clip or active word changes", () => {
		const record = buildRecord();
		const index = createCapinstaCaptionTimingIndex({ records: [record] });
		const firstWord = record.document.words[0]!;
		const state = getActiveCapinstaCaptionStateFromIndex({
			index,
			timeSeconds: firstWord.start,
		});

		expect(activeCapinstaCaptionStateKey(state)).toContain(firstWord.id);
		expect(activeCapinstaCaptionStateKey(null)).toBe("none");
	});
});
