import { describe, expect, test } from "bun:test";
import type { NeutralCaptionDocument } from "./types";
import {
	addSegment,
	deleteSegment,
	formatSubtitleTime,
	mergeSegments,
	parseSubtitleTime,
	replaceCaptionText,
	splitSegment,
	updateSegmentText,
	updateSegmentTiming,
	validateSegmentTiming,
} from "./captionEditing";

function documentFixture(): NeutralCaptionDocument {
	return {
		id: "doc",
		trackId: "track",
		sourceTranscriptRef: {
			version: "capinsta.transcript.v1",
			sourceAssetId: "asset",
			sourceAssetName: "video.mp4",
			provider: "sarvam",
		},
		durationSeconds: 10,
		languageMode: "auto_mixed_indian",
		stylePresetId: "word_highlight_box",
		clips: [
			{
				id: "c1",
				sourceClipId: "c1",
				trackId: "track",
				start: 0,
				end: 2,
				text: "hello world",
				wordIds: ["w1", "w2"],
				stylePresetId: "word_highlight_box",
				selected: false,
				editable: true,
				manuallyEdited: false,
				timingNeedsReview: false,
				timingSource: "provider",
			},
			{
				id: "c2",
				sourceClipId: "c2",
				trackId: "track",
				start: 2,
				end: 4,
				text: "next line",
				wordIds: ["w3", "w4"],
				stylePresetId: "word_highlight_box",
				selected: false,
				editable: true,
				manuallyEdited: false,
				timingNeedsReview: false,
				timingSource: "provider",
			},
		],
		words: [
			{ id: "w1", sourceWordId: "w1", text: "hello", displayedText: "hello", start: 0, end: 1, timingSource: "provider" },
			{ id: "w2", sourceWordId: "w2", text: "world", displayedText: "world", start: 1, end: 2, timingSource: "provider" },
			{ id: "w3", sourceWordId: "w3", text: "next", displayedText: "next", start: 2, end: 3, timingSource: "provider" },
			{ id: "w4", sourceWordId: "w4", text: "line", displayedText: "line", start: 3, end: 4, timingSource: "provider" },
		],
		manualEdits: {},
		timing: {
			sourceOfTruth: "words",
			generatedAt: "2026-06-20T00:00:00Z",
		},
	};
}

describe("caption editing", () => {
	test("parses and formats millisecond timecodes", () => {
		expect(parseSubtitleTime("00:01:02.239")).toBe(62.239);
		expect(formatSubtitleTime(62.239)).toBe("00:01:02.239");
	});

	test("rejects negative and reversed timing", () => {
		expect(validateSegmentTiming({ start: -1, end: 2, mediaDuration: 10 })).toContain("negative");
		expect(validateSegmentTiming({ start: 2, end: 1, mediaDuration: 10 })).toContain("after");
	});

	test("rejects timing beyond media duration", () => {
		expect(validateSegmentTiming({ start: 8, end: 11, mediaDuration: 10 })).toContain("duration");
	});

	test("edits Telugu and mixed-language text", () => {
		const next = updateSegmentText({
			document: documentFixture(),
			clipId: "c1",
			text: "నేను AI captions మార్చాను",
		});
		expect(next.clips[0]?.text).toBe("నేను AI captions మార్చాను");
		expect(next.clips[0]?.wordIds).toHaveLength(4);
	});

	test("preserves word timings when count is unchanged", () => {
		const next = updateSegmentText({
			document: documentFixture(),
			clipId: "c1",
			text: "good morning",
		});
		expect(next.words.find((word) => word.id === "w1")?.start).toBe(0);
		expect(next.words.find((word) => word.id === "w2")?.end).toBe(2);
	});

	test("retimes added words and removes stale words", () => {
		const added = updateSegmentText({
			document: documentFixture(),
			clipId: "c1",
			text: "hello brave new world",
		});
		expect(added.clips[0]?.wordIds).toHaveLength(4);
		const removed = updateSegmentText({
			document: added,
			clipId: "c1",
			text: "hello",
		});
		expect(removed.clips[0]?.wordIds).toHaveLength(1);
		expect(removed.words.filter((word) => removed.clips[0]?.wordIds.includes(word.id))).toHaveLength(1);
	});

	test("retimes words with a segment timing edit", () => {
		const next = updateSegmentTiming({
			document: documentFixture(),
			clipId: "c1",
			start: 1,
			end: 5,
		});
		expect(next.clips[0]).toMatchObject({ start: 1, end: 5 });
		expect(next.words.find((word) => word.id === "w1")).toMatchObject({ start: 1, end: 3 });
	});

	test("splits, merges, adds and deletes segments", () => {
		const split = splitSegment({
			document: documentFixture(),
			clipId: "c1",
			characterIndex: 5,
		});
		expect(split.clips).toHaveLength(3);
		const merged = mergeSegments({
			document: documentFixture(),
			firstId: "c1",
			secondId: "c2",
		});
		expect(merged.clips).toHaveLength(1);
		expect(merged.clips[0]?.text).toBe("hello world next line");
		const added = addSegment({ document: documentFixture(), at: 5 });
		expect(added.clips).toHaveLength(3);
		expect(deleteSegment({ document: added, clipId: added.clips[2]!.id }).clips).toHaveLength(2);
	});

	test("search and replace updates words", () => {
		const next = replaceCaptionText({
			document: documentFixture(),
			search: "line",
			replacement: "caption",
		});
		expect(next.clips[1]?.text).toBe("next caption");
		expect(next.words.find((word) => word.id === "w4")?.displayedText).toBe("caption");
	});
});
