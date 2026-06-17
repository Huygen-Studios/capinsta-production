/* eslint-disable opencut/prefer-object-params -- Test fixtures stay compact for selected element lists. */
import { describe, expect, mock, test } from "bun:test";
import { capinstaTranscriptToCaptionDocument } from "./adapter";
import { sampleCapinstaTranscriptV1 } from "./sampleTranscript";
import type { CapinstaCaptionDocumentRecord } from "./types";
import type { SceneTracks, TextElement, TextTrack } from "@/timeline";

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
	applyPresetToCapinstaSelection,
	applyStylePatchToCapinstaSelection,
	getCommonStyleValue,
	getSelectedCapinstaCaptionRefs,
} = await import("./bulkStyleSync");
const { getCapinstaPresetStyle } = await import("./styles/presetRegistry");
const { getCapinstaTextRenderDataForElement } = await import("./exportRender");

function mediaTimeFromSeconds(seconds: number) {
	return mediaTime({ ticks: Math.round(seconds * TICKS_PER_SECOND) });
}

function buildRecord(): CapinstaCaptionDocumentRecord {
	const document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1);
	return {
		document: {
			...document,
			clips: document.clips.map((clip) => ({
				...clip,
				style: getCapinstaPresetStyle("word_highlight_box"),
			})),
		},
		openCutTrackId: "caption-track",
		importedAt: "2026-06-15T10:00:00.000Z",
	};
}

function buildTextElement({
	record,
	clipIndex,
	id,
}: {
	record: CapinstaCaptionDocumentRecord;
	clipIndex: number;
	id?: string;
}): TextElement {
	const clip = record.document.clips[clipIndex]!;
	return {
		id: id ?? `element-${clip.id}`,
		type: "text",
		name: clip.text,
		startTime: mediaTimeFromSeconds(clip.start),
		duration: mediaTimeFromSeconds(clip.end - clip.start),
		trimStart: 0,
		trimEnd: 0,
		params: { content: clip.text },
		capinstaDocumentId: record.document.id,
		capinstaClipId: clip.id,
	};
}

function buildPlainTextElement(): TextElement {
	return {
		id: "plain-text",
		type: "text",
		name: "Plain text",
		startTime: mediaTimeFromSeconds(0),
		duration: mediaTimeFromSeconds(1),
		trimStart: 0,
		trimEnd: 0,
		params: { content: "Plain OpenCut text", color: "#abcdef" },
	};
}

function buildTracks(record: CapinstaCaptionDocumentRecord): {
	tracks: SceneTracks;
	captionElements: TextElement[];
	plainElement: TextElement;
} {
	const captionElements = [
		buildTextElement({ record, clipIndex: 0 }),
		buildTextElement({ record, clipIndex: 1 }),
	];
	const plainElement = buildPlainTextElement();
	const textTrack: TextTrack = {
		id: record.openCutTrackId,
		type: "text",
		name: "Captions",
		hidden: false,
		elements: [...captionElements, plainElement],
	};
	return {
		captionElements,
		plainElement,
		tracks: {
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
		},
	};
}

function selectElements(elements: TextElement[], trackId = "caption-track") {
	return elements.map((element) => ({ trackId, elementId: element.id }));
}

describe("Capinsta bulk style synchronization", () => {
	test("selecting one Capinsta caption returns single selectable ref", () => {
		const record = buildRecord();
		const { tracks, captionElements } = buildTracks(record);

		const result = getSelectedCapinstaCaptionRefs({
			selection: selectElements([captionElements[0]!]),
			tracks,
			records: [record],
		});

		expect(result.selectedCapinstaClipRefs).toHaveLength(1);
		expect(result.selectedCapinstaClipRefs[0]?.clipId).toBe(record.document.clips[0]?.id);
		expect(result.ignoredCount).toBe(0);
	});

	test("selecting multiple Capinsta captions returns bulk refs", () => {
		const record = buildRecord();
		const { tracks, captionElements } = buildTracks(record);

		const result = getSelectedCapinstaCaptionRefs({
			selection: selectElements(captionElements.slice(0, 2)),
			tracks,
			records: [record],
		});

		expect(result.selectedCapinstaClipRefs).toHaveLength(2);
		expect(result.ignoredCount).toBe(0);
	});

	test("mixed selection ignores non-Capinsta elements", () => {
		const record = buildRecord();
		const { tracks, captionElements, plainElement } = buildTracks(record);

		const result = getSelectedCapinstaCaptionRefs({
			selection: selectElements([captionElements[0]!, plainElement]),
			tracks,
			records: [record],
		});

		expect(result.selectedCapinstaClipRefs).toHaveLength(1);
		expect(result.ignoredCount).toBe(1);
	});

	test("applying preset updates all selected caption styles", () => {
		const record = buildRecord();
		const { tracks, captionElements } = buildTracks(record);
		const selectedRefs = getSelectedCapinstaCaptionRefs({
			selection: selectElements(captionElements.slice(0, 2)),
			tracks,
			records: [record],
		}).selectedCapinstaClipRefs;

		const { records, timelineUpdates, tracks: nextTracks } = applyPresetToCapinstaSelection({
			records: [record],
			tracks,
			selectedRefs,
			presetId: "mrbeast_style",
		});

		expect(records[0]?.document.clips[0]?.style?.presetId).toBe("mrbeast_style");
		expect(records[0]?.document.clips[1]?.style?.presetId).toBe("mrbeast_style");
		expect(records[0]?.document.clips.map((clip) => clip.text)).toEqual([
			"Build the",
			"edit",
			"then",
			"captions",
			"follow",
		]);
		expect(timelineUpdates).toHaveLength(0);
		const textTrack = nextTracks?.overlay.find((track) => track.id === record.openCutTrackId);
		expect(textTrack?.elements.filter((element) => element.capinstaDocumentId === record.document.id)).toHaveLength(5);
	});

	test("applying text color and font size updates all selected styles", () => {
		const record = buildRecord();
		const { tracks, captionElements } = buildTracks(record);
		const selectedRefs = getSelectedCapinstaCaptionRefs({
			selection: selectElements(captionElements.slice(0, 2)),
			tracks,
			records: [record],
		}).selectedCapinstaClipRefs;

		const { records, timelineUpdates } = applyStylePatchToCapinstaSelection({
			records: [record],
			tracks,
			selectedRefs,
			stylePatch: { text: { color: "#123456", fontSize: 88 } },
		});

		expect(records[0]?.document.clips[0]?.style?.text.color).toBe("#123456");
		expect(records[0]?.document.clips[1]?.style?.text.fontSize).toBe(88);
		expect(timelineUpdates.map((update) => update.patch.params.color)).toEqual([
			"#123456",
			"#123456",
		]);
		expect(timelineUpdates.map((update) => update.patch.params.fontSize)).toEqual([
			7.333,
			7.333,
		]);
	});

	test("applying layout position updates all selected caption styles", () => {
		const record = buildRecord();
		const { tracks, captionElements } = buildTracks(record);
		const selectedRefs = getSelectedCapinstaCaptionRefs({
			selection: selectElements(captionElements.slice(0, 2)),
			tracks,
			records: [record],
		}).selectedCapinstaClipRefs;

		const { records } = applyStylePatchToCapinstaSelection({
			records: [record],
			tracks,
			selectedRefs,
			stylePatch: { layout: { positionX: 42, positionY: 68 } },
		});

		expect(records[0]?.document.clips[0]?.style?.layout.positionX).toBe(42);
		expect(records[0]?.document.clips[1]?.style?.layout.positionY).toBe(68);
	});

	test("timing, text, words, and manual edit metadata are preserved", () => {
		const record = buildRecord();
		const originalClip = {
			...record.document.clips[0]!,
			timingNeedsReview: true,
			manualEdit: {
				textEditedAt: "2026-06-16T10:00:00.000Z",
				originalText: "Original",
			},
		};
		const preparedRecord = {
			...record,
			document: {
				...record.document,
				clips: [originalClip, ...record.document.clips.slice(1)],
			},
		};
		const { tracks, captionElements } = buildTracks(preparedRecord);
		const selectedRefs = getSelectedCapinstaCaptionRefs({
			selection: selectElements([captionElements[0]!]),
			tracks,
			records: [preparedRecord],
		}).selectedCapinstaClipRefs;

		const { records } = applyStylePatchToCapinstaSelection({
			records: [preparedRecord],
			tracks,
			selectedRefs,
			stylePatch: { text: { color: "#654321" } },
		});
		const updatedClip = records[0]!.document.clips[0]!;

		expect(updatedClip.text).toBe(originalClip.text);
		expect(updatedClip.start).toBe(originalClip.start);
		expect(updatedClip.end).toBe(originalClip.end);
		expect(updatedClip.wordIds).toEqual(originalClip.wordIds);
		expect(records[0]?.document.words).toEqual(preparedRecord.document.words);
		expect(updatedClip.timingNeedsReview).toBe(true);
		expect(updatedClip.manualEdit).toEqual(originalClip.manualEdit);
	});

	test("mixed values are detected", () => {
		const record = buildRecord();
		const { tracks, captionElements } = buildTracks(record);
		const selectedRefs = getSelectedCapinstaCaptionRefs({
			selection: selectElements(captionElements.slice(0, 2)),
			tracks,
			records: [record],
		}).selectedCapinstaClipRefs;
		const { records } = applyStylePatchToCapinstaSelection({
			records: [record],
			tracks,
			selectedRefs: [selectedRefs[0]!],
			stylePatch: { text: { color: "#111111" } },
		});
		const nextRefs = getSelectedCapinstaCaptionRefs({
			selection: selectElements(captionElements.slice(0, 2)),
			tracks,
			records,
		}).selectedCapinstaClipRefs;

		expect(getCommonStyleValue(nextRefs, "text.color")).toBeUndefined();
		expect(getCommonStyleValue(nextRefs, "text.fontSize")).toBe(54);
	});

	test("style persists after JSON reload and export mapping sees updated style", () => {
		const record = buildRecord();
		const { tracks, captionElements } = buildTracks(record);
		const selectedRefs = getSelectedCapinstaCaptionRefs({
			selection: selectElements(captionElements.slice(0, 2)),
			tracks,
			records: [record],
		}).selectedCapinstaClipRefs;
		const { records } = applyStylePatchToCapinstaSelection({
			records: [record],
			tracks,
			selectedRefs,
			stylePatch: { text: { color: "#ff00aa" } },
		});
		const restoredRecords = JSON.parse(JSON.stringify(records));

		const renderData = getCapinstaTextRenderDataForElement({
			records: restoredRecords,
			element: captionElements[0]!,
		});

		expect(restoredRecords[0].document.clips[0].style.text.color).toBe(
			"#ff00aa",
		);
		expect(renderData?.style.textColor).toBe("#ff00aa");
		expect(renderData?.clipText).toBe(record.document.clips[0]?.text);
	});

	test("normal OpenCut text is unaffected by bulk style updates", () => {
		const record = buildRecord();
		const { tracks, captionElements, plainElement } = buildTracks(record);
		const result = getSelectedCapinstaCaptionRefs({
			selection: selectElements([captionElements[0]!, plainElement]),
			tracks,
			records: [record],
		});
		const { timelineUpdates } = applyStylePatchToCapinstaSelection({
			records: [record],
			tracks,
			selectedRefs: result.selectedCapinstaClipRefs,
			stylePatch: { text: { color: "#101010" } },
		});

		expect(result.ignoredCount).toBe(1);
		expect(timelineUpdates.map((update) => update.elementId)).not.toContain(
			plainElement.id,
		);
		expect(plainElement.params).toEqual({
			content: "Plain OpenCut text",
			color: "#abcdef",
		});
	});
});
