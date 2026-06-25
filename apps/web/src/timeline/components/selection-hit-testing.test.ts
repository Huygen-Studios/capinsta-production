import { describe, expect, mock, test } from "bun:test";
import type { TextElement, TimelineTrack } from "@/timeline";

mock.module("opencut-wasm", () => ({
	TICKS_PER_SECOND: () => 120_000,
}));

const { resolveTimelineElementIntersections } = await import(
	"./selection-hit-testing"
);

const caption = ({
	id,
	startTime,
}: {
	id: string;
	startTime: number;
}): TextElement => ({
	id,
	type: "text",
	name: id,
	startTime,
	duration: 120_000,
	trimStart: 0,
	trimEnd: 120_000,
	params: { content: id },
});

function makeHitTestTrack(): TimelineTrack {
	return {
		id: "caption-track",
		type: "text",
		name: "Captions",
		hidden: false,
		elements: [
			caption({ id: "caption-1", startTime: 120_000 }),
			caption({ id: "caption-2", startTime: 360_000 }),
			caption({ id: "caption-3", startTime: 720_000 }),
		],
	};
}

function makeElementRect({ left = 0, top = 0 } = {}) {
	return {
		getBoundingClientRect: () => ({
			left,
			top,
			right: left + 800,
			bottom: top + 200,
			width: 800,
			height: 200,
		}),
	} as HTMLElement;
}

describe("timeline marquee hit testing", () => {
	test("selects every timeline element intersecting the rectangle in either drag direction", () => {
		const container = makeElementRect();
		const scrollContainer = {
			scrollLeft: 0,
			scrollTop: 0,
			getBoundingClientRect: () => ({
				left: 0,
				top: 0,
				right: 800,
				bottom: 200,
				width: 800,
				height: 200,
			}),
		} as HTMLDivElement;

		const leftToRight = resolveTimelineElementIntersections({
			container,
			scrollContainer,
			tracks: [makeHitTestTrack()],
			zoomLevel: 1,
			startPos: { x: 40, y: 0 },
			currentPos: { x: 270, y: 35 },
		});
		const rightToLeft = resolveTimelineElementIntersections({
			container,
			scrollContainer,
			tracks: [makeHitTestTrack()],
			zoomLevel: 1,
			startPos: { x: 270, y: 35 },
			currentPos: { x: 40, y: 0 },
		});

		expect(leftToRight).toEqual([
			{ trackId: "caption-track", elementId: "caption-1" },
			{ trackId: "caption-track", elementId: "caption-2" },
		]);
		expect(rightToLeft).toEqual(leftToRight);
	});

	test("uses fixed content coordinates so auto-scroll can reveal off-screen selections", () => {
		const container = makeElementRect();
		const scrollContainer = {
			scrollLeft: 300,
			scrollTop: 0,
			getBoundingClientRect: () => ({
				left: 0,
				top: 0,
				right: 800,
				bottom: 200,
				width: 800,
				height: 200,
			}),
		} as HTMLDivElement;

		const selected = resolveTimelineElementIntersections({
			container,
			scrollContainer,
			tracks: [makeHitTestTrack()],
			zoomLevel: 1,
			startPos: { x: 60, y: 0 },
			currentPos: { x: 460, y: 35 },
			startContentPos: { x: 60, y: 0 },
			currentContentPos: { x: 760, y: 35 },
		});

		expect(selected).toEqual([
			{ trackId: "caption-track", elementId: "caption-1" },
			{ trackId: "caption-track", elementId: "caption-2" },
			{ trackId: "caption-track", elementId: "caption-3" },
		]);
	});
});
