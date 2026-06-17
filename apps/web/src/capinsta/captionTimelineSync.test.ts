import { describe, expect, mock, test } from "bun:test";
import { capinstaTranscriptToCaptionDocument } from "./adapter";
import { sampleCapinstaTranscriptV1 } from "./sampleTranscript";
import type {
	CapinstaCaptionDocumentRecord,
	NeutralCaptionDocument,
} from "./types";
import type { SceneTracks, TextElement, TextTrack } from "@/timeline";

const EDITED_AT = "2026-06-16T10:00:00.000Z";
const TICKS_PER_SECOND = 120_000;

mock.module("opencut-wasm", () => ({
	TICKS_PER_SECOND: () => TICKS_PER_SECOND,
	mediaTimeFromSeconds: ({ seconds }: { seconds: number }) =>
		Math.round(seconds * TICKS_PER_SECOND),
	mediaTimeToSeconds: ({ time }: { time: number }) =>
		time / TICKS_PER_SECOND,
	lastFrameTime: ({ duration }: { duration: number }) => duration,
	parseTimecode: () => undefined,
	roundToFrame: ({ time }: { time: number }) => time,
	snappedSeekTime: ({ time }: { time: number }) => time,
}));

const { mediaTime } = await import("@/wasm");
const {
	buildCapinstaPreviewTracks,
	getActiveCapinstaCaptionState,
	syncCapinstaCaptionDocumentsFromTimeline,
} = await import("./captionTimelineSync");

function mediaTimeFromSeconds(seconds: number) {
	return mediaTime({ ticks: Math.round(seconds * TICKS_PER_SECOND) });
}

function buildRecord(): CapinstaCaptionDocumentRecord {
	return {
		document: capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1),
		openCutTrackId: "caption-track",
		importedAt: "2026-06-15T10:00:00.000Z",
	};
}

function buildTextElement({
	document,
	clipIndex,
	text,
	start,
	end,
}: {
	document: NeutralCaptionDocument;
	clipIndex: number;
	text?: string;
	start?: number;
	end?: number;
}): TextElement {
	const clip = document.clips[clipIndex]!;
	return {
		id: `element-${clip.id}`,
		type: "text",
		name: clip.text,
		startTime: mediaTimeFromSeconds(start ?? clip.start),
		duration: mediaTimeFromSeconds(
			(end ?? clip.end) - (start ?? clip.start),
		),
		trimStart: 0,
		trimEnd: 0,
		params: { content: text ?? clip.text },
		capinstaDocumentId: document.id,
		capinstaClipId: clip.id,
	};
}

function buildTracks({
	record,
	firstElement,
}: {
	record: CapinstaCaptionDocumentRecord;
	firstElement?: TextElement;
}): SceneTracks {
	const textTrack: TextTrack = {
		id: record.openCutTrackId,
		type: "text",
		name: "Captions",
		hidden: false,
		elements: [
			firstElement ?? buildTextElement({ document: record.document, clipIndex: 0 }),
			buildTextElement({ document: record.document, clipIndex: 1 }),
		],
	};
	return {
		overlay: [textTrack],
		main: {
			id: "main",
			type: "video",
			name: "Main",
			muted: false,
			hidden: false,
			elements: [],
		},
		audio: [],
	};
}

describe("Capinsta timeline synchronization", () => {
	test("resolves active captions and words at inclusive/exclusive boundaries", () => {
		const record = buildRecord();

		expect(
			getActiveCapinstaCaptionState({
				records: [record],
				timeSeconds: record.document.words[0]!.start,
			})?.activeWordIds,
		).toEqual([record.document.words[0]!.id]);
		expect(
			getActiveCapinstaCaptionState({
				records: [record],
				timeSeconds: record.document.words[0]!.end,
			})?.activeWordIds,
		).not.toContain(record.document.words[0]!.id);
	});

	test("syncs same-word-count edits onto existing word timings", () => {
		const record = buildRecord();
		const afterTracks = buildTracks({
			record,
			firstElement: buildTextElement({
				document: record.document,
				clipIndex: 0,
				text: "Make the clean cut",
			}),
		});
		const [updated] = syncCapinstaCaptionDocumentsFromTimeline({
			records: [record],
			afterTracks,
			editedAt: EDITED_AT,
		});

		expect(updated!.document.clips[0]!.text).toBe("Make the clean cut");
		expect(updated!.document.words.slice(0, 4).map((word) => word.displayedText)).toEqual([
			"Make",
			"the",
			"clean",
			"cut",
		]);
		expect(updated!.document.words[0]!.start).toBe(record.document.words[0]!.start);
		expect(updated!.document.clips[0]!.timingNeedsReview).toBe(false);
	});

	test("keeps best-effort active-word highlighting when edited word count changes", () => {
		const record = buildRecord();
		const afterTracks = buildTracks({
			record,
			firstElement: buildTextElement({
				document: record.document,
				clipIndex: 0,
				text: "Make a much better edit",
			}),
		});
		const [updated] = syncCapinstaCaptionDocumentsFromTimeline({
			records: [record],
			afterTracks,
			editedAt: EDITED_AT,
		});

		expect(updated!.document.clips[0]!.timingNeedsReview).toBe(true);
		expect(updated!.document.words[0]!.displayedText).toBe(
			record.document.words[0]!.displayedText,
		);
		expect(
			getActiveCapinstaCaptionState({
				records: [updated!],
				timeSeconds: record.document.words[0]!.start,
			})?.activeWordIds,
		).toEqual([record.document.words[0]!.id]);
	});

	test("offsets word timings when a caption is moved", () => {
		const record = buildRecord();
		const clip = record.document.clips[0]!;
		const afterTracks = buildTracks({
			record,
			firstElement: buildTextElement({
				document: record.document,
				clipIndex: 0,
				start: clip.start + 1,
				end: clip.end + 1,
			}),
		});
		const [updated] = syncCapinstaCaptionDocumentsFromTimeline({
			records: [record],
			afterTracks,
			editedAt: EDITED_AT,
		});

		expect(updated!.document.clips[0]!.start).toBeCloseTo(clip.start + 1);
		expect(updated!.document.words[0]!.start).toBeCloseTo(
			record.document.words[0]!.start + 1,
		);
		expect(updated!.document.clips[0]!.timingNeedsReview).toBe(false);
	});

	test("keeps explicit Capinsta bindings when a caption moves to another text track", () => {
		const record = buildRecord();
		const clip = record.document.clips[0]!;
		const movedElement = buildTextElement({
			document: record.document,
			clipIndex: 0,
			start: clip.start + 1,
			end: clip.end + 1,
		});
		const afterTracks = buildTracks({ record, firstElement: movedElement });
		const originalTrack = afterTracks.overlay[0];
		if (originalTrack?.type !== "text") {
			throw new Error("Expected the fixture to create a text track");
		}
		afterTracks.overlay = [
			{ ...originalTrack, elements: originalTrack.elements.slice(1) },
			{
				id: "moved-caption-track",
				type: "text",
				name: "Moved captions",
				hidden: false,
				elements: [movedElement],
			},
		];

		const [updated] = syncCapinstaCaptionDocumentsFromTimeline({
			records: [record],
			afterTracks,
			editedAt: EDITED_AT,
		});

		expect(updated!.document.clips[0]!.start).toBeCloseTo(clip.start + 1);
		expect(updated!.document.words[0]!.start).toBeCloseTo(
			record.document.words[0]!.start + 1,
		);
		expect(updated!.document.clips[0]!.timingNeedsReview).toBe(false);
	});

	test("marks timing for review when a caption duration changes", () => {
		const record = buildRecord();
		const clip = record.document.clips[0]!;
		const afterTracks = buildTracks({
			record,
			firstElement: buildTextElement({
				document: record.document,
				clipIndex: 0,
				end: clip.end - 0.4,
			}),
		});
		const [updated] = syncCapinstaCaptionDocumentsFromTimeline({
			records: [record],
			afterTracks,
			editedAt: EDITED_AT,
		});

		expect(updated!.document.clips[0]!.timingNeedsReview).toBe(true);
		expect(updated!.document.words[0]!.start).toBe(record.document.words[0]!.start);
		expect(updated!.document.clips[0]!.manualEdit?.timingReviewReason).toBe(
			"clip_duration_changed",
		);
	});

	test("suppresses the whole generated Capinsta caption track in preview", () => {
		const record = buildRecord();
		const tracks = buildTracks({ record });
		const capinstaTrack = tracks.overlay[0];
		if (capinstaTrack?.type !== "text") {
			throw new Error("Expected the fixture to create a text track");
		}
		const staleElement: TextElement = {
			...buildTextElement({ document: record.document, clipIndex: 0 }),
			id: "stale-open-cut-caption",
			capinstaDocumentId: undefined,
			capinstaClipId: undefined,
			params: { content: "stale default subtitle" },
		};
		const normalText: TextElement = {
			...staleElement,
			id: "normal-text",
			params: { content: "ordinary text" },
		};
		tracks.overlay = [
			{
				...capinstaTrack,
				elements: [...capinstaTrack.elements, staleElement],
			},
			{
				id: "normal-text-track",
				type: "text",
				name: "Normal text",
				hidden: false,
				elements: [normalText],
			},
		];

		const previewTracks = buildCapinstaPreviewTracks({
			records: [record],
			tracks,
		});
		const hiddenCaptionTrack = previewTracks.overlay[0];
		const visibleTextTrack = previewTracks.overlay[1];

		if (hiddenCaptionTrack?.type !== "text" || visibleTextTrack?.type !== "text") {
			throw new Error("Expected text tracks");
		}
		expect(hiddenCaptionTrack.elements.every((element) => element.hidden)).toBe(
			true,
		);
		expect(visibleTextTrack.elements[0]!.hidden).toBeUndefined();
	});
});
