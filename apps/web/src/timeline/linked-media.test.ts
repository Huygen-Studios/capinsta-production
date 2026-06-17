import { describe, expect, mock, test } from "bun:test";
import type { SceneTracks, VideoElement, AudioElement, TextElement } from "@/timeline";

mock.module("opencut-wasm", () => ({
	TICKS_PER_SECOND: () => 120_000,
	ZERO_MEDIA_TIME: 0,
	ONE_MEDIA_TICK: 1,
	mediaTime: ({ ticks }: { ticks: number }) => ticks,
	mediaTimeFromSeconds: ({ seconds }: { seconds: number }) =>
		Math.round(seconds * 120_000),
	mediaTimeToSeconds: ({ time }: { time: number }) => time / 120_000,
	addMediaTime: ({ a, b }: { a: number; b: number }) => a + b,
	subMediaTime: ({ a, b }: { a: number; b: number }) => a - b,
	maxMediaTime: ({ a, b }: { a: number; b: number }) => Math.max(a, b),
	minMediaTime: ({ a, b }: { a: number; b: number }) => Math.min(a, b),
	lastFrameTime: ({ duration }: { duration: number }) => duration,
	lastFrameMediaTime: ({ duration }: { duration: number }) => duration,
	parseTimecode: () => undefined,
	roundToFrame: ({ time }: { time: number }) => time,
	roundFrameTime: ({ time }: { time: number }) => time,
	snappedSeekTime: ({ time }: { time: number }) => time,
}));

const { buildLinkedVideoAudioElements, expandElementRefsWithLinkedMedia } =
	await import("./linked-media");
const { buildMoveGroup } = await import("./group-move");
const { buildResizeMembers } = await import("./controllers/resize-controller");

const TEST_DURATION = 1000 as VideoElement["duration"];
const TEST_START_TIME = 0 as VideoElement["startTime"];

function makeVideoElement(id: string): VideoElement {
	return {
		id,
		type: "video",
		mediaId: "media-1",
		name: "clip.mp4",
		duration: TEST_DURATION,
		startTime: TEST_START_TIME,
		trimStart: TEST_START_TIME,
		trimEnd: TEST_DURATION,
		params: {},
		linkedMediaGroupId: "linked-1",
		linkedTrackRole: "video",
		sourceAssetId: "media-1",
	};
}

function makeAudioElement(id: string): AudioElement {
	return {
		id,
		type: "audio",
		sourceType: "upload",
		mediaId: "media-1",
		name: "clip.mp4",
		duration: TEST_DURATION,
		startTime: TEST_START_TIME,
		trimStart: TEST_START_TIME,
		trimEnd: TEST_DURATION,
		params: {},
		linkedMediaGroupId: "linked-1",
		linkedTrackRole: "audio",
		sourceAssetId: "media-1",
	};
}

function makeTracks(): SceneTracks {
	return {
		overlay: [],
		main: {
			id: "video-track",
			type: "video",
			name: "Video",
			muted: false,
			hidden: false,
			elements: [makeVideoElement("video-1")],
		},
		audio: [
			{
				id: "audio-track",
				type: "audio",
				name: "Audio",
				muted: false,
				elements: [makeAudioElement("audio-1")],
			},
		],
	};
}

function makeCapinstaCaptionElement(id: string, clipId: string): TextElement {
	return {
		id,
		type: "text",
		name: clipId,
		duration: TEST_DURATION,
		startTime: TEST_START_TIME,
		trimStart: TEST_START_TIME,
		trimEnd: TEST_DURATION,
		params: { content: clipId },
		capinstaDocumentId: "capinsta-doc-1",
		capinstaClipId: clipId,
	};
}

function makeTracksWithCapinstaCaptions(): SceneTracks {
	return {
		...makeTracks(),
		overlay: [
			{
				id: "caption-track",
				type: "text",
				name: "Captions",
				hidden: false,
				elements: [
					makeCapinstaCaptionElement("caption-1", "clip-1"),
					makeCapinstaCaptionElement("caption-2", "clip-2"),
					makeCapinstaCaptionElement("caption-3", "clip-3"),
				],
			},
		],
	};
}

describe("linked media timeline helpers", () => {
	test("creates a linked video and audio pair from one source asset", () => {
		const { videoElement, audioElement } = buildLinkedVideoAudioElements({
			mediaAsset: {
				id: "media-1",
				name: "clip.mp4",
				type: "video",
				file: new File(["video"], "clip.mp4", { type: "video/mp4" }),
				duration: 1,
				hasAudio: true,
			},
			startTime: TEST_START_TIME,
			duration: TEST_DURATION,
		});

		expect(videoElement).toMatchObject({
			type: "video",
			mediaId: "media-1",
			linkedTrackRole: "video",
			sourceAssetId: "media-1",
			isSourceAudioEnabled: false,
		});
		expect(audioElement).toMatchObject({
			type: "audio",
			mediaId: "media-1",
			linkedTrackRole: "audio",
			sourceAssetId: "media-1",
		});
		expect(videoElement.linkedMediaGroupId).toBeTruthy();
		expect(audioElement.linkedMediaGroupId).toBe(
			videoElement.linkedMediaGroupId,
		);
	});

	test("expands a selected video ref to include its linked audio ref", () => {
		const refs = expandElementRefsWithLinkedMedia({
			tracks: makeTracks(),
			elementRefs: [{ trackId: "video-track", elementId: "video-1" }],
		});

		expect(refs).toEqual([
			{ trackId: "video-track", elementId: "video-1" },
			{ trackId: "audio-track", elementId: "audio-1" },
		]);
	});

	test("expands a selected audio ref to include its linked video ref", () => {
		const refs = expandElementRefsWithLinkedMedia({
			tracks: makeTracks(),
			elementRefs: [{ trackId: "audio-track", elementId: "audio-1" }],
		});

		expect(refs).toEqual([
			{ trackId: "audio-track", elementId: "audio-1" },
			{ trackId: "video-track", elementId: "video-1" },
		]);
	});

	test("moves a linked pair when either element is dragged", () => {
		const group = buildMoveGroup({
			tracks: makeTracks(),
			anchorRef: { trackId: "video-track", elementId: "video-1" },
			selectedElements: [
				{ trackId: "video-track", elementId: "video-1" },
			],
		});

		expect(group?.members.map((member) => member.elementId).sort()).toEqual([
			"audio-1",
			"video-1",
		]);
	});

	test("trims a linked pair together", () => {
		const members = buildResizeMembers({
			tracks: makeTracks(),
			selectedElements: [
				{ trackId: "audio-track", elementId: "audio-1" },
			],
		});

		expect(members.map((member) => member.elementId).sort()).toEqual([
			"audio-1",
			"video-1",
		]);
	});

	test("expands a selected Capinsta caption ref to include sibling caption clips", () => {
		const refs = expandElementRefsWithLinkedMedia({
			tracks: makeTracksWithCapinstaCaptions(),
			elementRefs: [{ trackId: "caption-track", elementId: "caption-2" }],
		});

		expect(refs).toEqual([
			{ trackId: "caption-track", elementId: "caption-2" },
			{ trackId: "caption-track", elementId: "caption-1" },
			{ trackId: "caption-track", elementId: "caption-3" },
		]);
	});
});
