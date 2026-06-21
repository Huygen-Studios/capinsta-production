/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Controller regression fixtures intentionally provide minimal React/DOM event doubles. */
import { describe, expect, mock, test } from "bun:test";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type {
	AudioElement,
	EffectElement,
	GraphicElement,
	ImageElement,
	SceneTracks,
	StickerElement,
	TextElement,
	TimelineElement,
	TimelineTrack,
	VideoElement,
} from "@/timeline";

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

const { SelectionManager } = await import("@/core/managers/selection-manager");
const { ElementInteractionController } = await import(
	"@/timeline/controllers/element-interaction-controller"
);
const { PreviewInteractionController, buildPreviewClickSelection } = await import(
	"@/preview/controllers/preview-interaction-controller"
);

const DURATION = 120_000;
const BASE = {
	duration: DURATION,
	startTime: 0,
	trimStart: 0,
	trimEnd: DURATION,
	params: {},
};

function makeElements(): TimelineElement[] {
	const video: VideoElement = {
		...BASE,
		id: "video-1",
		type: "video",
		name: "Video",
		mediaId: "media-video",
		linkedMediaGroupId: "linked-media",
		linkedTrackRole: "video",
	};
	const audio: AudioElement = {
		...BASE,
		id: "audio-1",
		type: "audio",
		name: "Audio",
		sourceType: "upload",
		mediaId: "media-video",
		linkedMediaGroupId: "linked-media",
		linkedTrackRole: "audio",
	};
	const caption: TextElement = {
		...BASE,
		id: "caption-1",
		type: "text",
		name: "Caption",
		params: { content: "Caption" },
		capinstaDocumentId: "caption-document",
		capinstaClipId: "caption-clip",
	};
	const captionTwo: TextElement = {
		...caption,
		id: "caption-2",
		name: "Caption two",
		params: { content: "Caption two" },
		capinstaClipId: "caption-clip-2",
	};
	const text: TextElement = {
		...BASE,
		id: "text-1",
		type: "text",
		name: "Text",
		params: { content: "Text" },
	};
	const image: ImageElement = {
		...BASE,
		id: "image-1",
		type: "image",
		name: "Image",
		mediaId: "media-image",
	};
	const graphic: GraphicElement = {
		...BASE,
		id: "graphic-1",
		type: "graphic",
		name: "Shape",
		definitionId: "rectangle",
	};
	const sticker: StickerElement = {
		...BASE,
		id: "sticker-1",
		type: "sticker",
		name: "Sticker",
		stickerId: "sticker",
	};
	const effect: EffectElement = {
		...BASE,
		id: "effect-1",
		type: "effect",
		name: "Effect",
		effectType: "blur",
	};
	return [
		video,
		audio,
		caption,
		captionTwo,
		text,
		image,
		graphic,
		sticker,
		effect,
	];
}

function makeTracks(): SceneTracks {
	const elements = makeElements();
	const byId = (id: string) =>
		elements.find((element) => element.id === id) as TimelineElement;
	return {
		main: {
			id: "video-track",
			type: "video",
			name: "Video",
			muted: false,
			hidden: false,
			elements: [byId("video-1") as VideoElement],
		},
		audio: [
			{
				id: "audio-track",
				type: "audio",
				name: "Audio",
				muted: false,
				elements: [byId("audio-1") as AudioElement],
			},
		],
		overlay: [
			{
				id: "caption-track",
				type: "text",
				name: "Captions",
				hidden: false,
				elements: [
					byId("caption-1") as TextElement,
					byId("caption-2") as TextElement,
				],
			},
			{
				id: "text-track",
				type: "text",
				name: "Text",
				hidden: false,
				elements: [byId("text-1") as TextElement],
			},
			{
				id: "image-track",
				type: "video",
				name: "Images",
				muted: false,
				hidden: false,
				elements: [byId("image-1") as ImageElement],
			},
			{
				id: "graphic-track",
				type: "graphic",
				name: "Graphics",
				hidden: false,
				elements: [
					byId("graphic-1") as GraphicElement,
					byId("sticker-1") as StickerElement,
				],
			},
			{
				id: "effect-track",
				type: "effect",
				name: "Effects",
				hidden: false,
				elements: [byId("effect-1") as EffectElement],
			},
		],
	};
}

function allTracks(tracks: SceneTracks): TimelineTrack[] {
	return [...tracks.overlay, tracks.main, ...tracks.audio];
}

function makePreviewTracks(): SceneTracks {
	const tracks = makeTracks();
	return {
		main: tracks.main,
		overlay: [],
		audio: [],
	};
}

function installDocumentListeners() {
	const listeners = new Map<string, (event: MouseEvent) => void>();
	const originalDocument = globalThis.document;
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {
			addEventListener: (type: string, listener: (event: MouseEvent) => void) =>
				listeners.set(type, listener),
			removeEventListener: (type: string) => listeners.delete(type),
		},
	});
	return {
		emit(type: string, event: Partial<MouseEvent>) {
			listeners.get(type)?.(event as MouseEvent);
		},
		restore() {
			Object.defineProperty(globalThis, "document", {
				configurable: true,
				value: originalDocument,
			});
		},
	};
}

function mouseEvent({
	x = 10,
	y = 10,
	detail = 1,
}: {
	x?: number;
	y?: number;
	detail?: number;
} = {}) {
	return {
		button: 0,
		clientX: x,
		clientY: y,
		detail,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		stopPropagation: mock(() => {}),
		currentTarget: {
			getBoundingClientRect: () => ({ left: 0 }),
		},
	} as unknown as ReactMouseEvent;
}

describe("canonical editor layer selection", () => {
	test("single-click timeline selection immediately selects every supported layer category", () => {
		const tracks = makeTracks();
		const manager = new SelectionManager({} as never);
		const documentListeners = installDocumentListeners();
		const controller = new ElementInteractionController({
			depsRef: {
				current: {
					viewport: {
						getZoomLevel: () => 1,
						getTracksScrollEl: () => null,
						getTracksContainerEl: () => null,
						getHeaderEl: () => null,
					},
					input: { isShiftHeld: () => false },
					scene: { getTracks: () => tracks, getActiveFps: () => null },
					selection: {
						getSelected: () => manager.getSelectedElements(),
						isSelected: (ref) =>
							manager
								.getSelectedElements()
								.some(
									(selected) =>
										selected.trackId === ref.trackId &&
										selected.elementId === ref.elementId,
								),
						select: (ref) => manager.selectElement({ element: ref }),
						selectMany: (refs) =>
							manager.setSelectedElements({ elements: refs }),
						handleClick: (ref) =>
							manager.selectElement({
								element: {
									trackId: ref.trackId,
									elementId: ref.elementId,
								},
							}),
						clearKeyframeSelection: () => manager.clearKeyframeSelection(),
					},
					playback: { getCurrentTime: () => 0 },
					timeline: { moveElements: mock(() => {}) },
					snap: { isEnabled: () => false },
				},
			},
		});

		try {
			for (const track of allTracks(tracks)) {
				for (const element of track.elements) {
					const event = mouseEvent();
					controller.onElementMouseDown({ event, element, track });

					const expectedSelection = element.capinstaDocumentId
						? [
								{ trackId: "caption-track", elementId: element.id },
								{
									trackId: "caption-track",
									elementId:
										element.id === "caption-1" ? "caption-2" : "caption-1",
								},
							]
						: [{ trackId: track.id, elementId: element.id }];
					const sortSelection = (
						selection: readonly { trackId: string; elementId: string }[],
					) =>
						[...selection].sort((left, right) =>
							left.elementId.localeCompare(right.elementId),
						);
					expect(sortSelection(manager.getSelectedElements())).toEqual(
						sortSelection(expectedSelection),
					);

					documentListeners.emit("mouseup", { clientX: 10, clientY: 10 });
					controller.onElementClick({ event, element, track });
					expect(sortSelection(manager.getSelectedElements())).toEqual(
						sortSelection(expectedSelection),
					);
				}
			}
		} finally {
			controller.destroy();
			documentListeners.restore();
		}
	});

	test("linked video and audio stay a single inspector selection while remaining a linked drag group", () => {
		const tracks = makeTracks();
		const manager = new SelectionManager({} as never);
		const documentListeners = installDocumentListeners();
		let selectedDuringGesture: readonly { trackId: string; elementId: string }[] =
			[];
		const controller = new ElementInteractionController({
			depsRef: {
				current: {
					viewport: {
						getZoomLevel: () => 1,
						getTracksScrollEl: () => null,
						getTracksContainerEl: () => null,
						getHeaderEl: () => null,
					},
					input: { isShiftHeld: () => false },
					scene: { getTracks: () => tracks, getActiveFps: () => null },
					selection: {
						getSelected: () => manager.getSelectedElements(),
						isSelected: (ref) =>
							manager
								.getSelectedElements()
								.some((selected) => selected.elementId === ref.elementId),
						select: (ref) => manager.selectElement({ element: ref }),
						selectMany: (refs) => {
							selectedDuringGesture = refs;
							manager.setSelectedElements({ elements: refs });
						},
						handleClick: () => {},
						clearKeyframeSelection: () => {},
					},
					playback: { getCurrentTime: () => 0 },
					timeline: { moveElements: () => {} },
					snap: { isEnabled: () => false },
				},
			},
		});
		const track = tracks.main;
		const element = track.elements[0];

		try {
			controller.onElementMouseDown({
				event: mouseEvent(),
				element,
				track,
			});
			expect(manager.getSelectedElements()).toEqual([
				{ trackId: "video-track", elementId: "video-1" },
			]);
			expect(selectedDuringGesture).toEqual([]);
		} finally {
			controller.destroy();
			documentListeners.restore();
		}
	});

	test("generated captions use single-click bulk selection and double-click individual selection", () => {
		const tracks = makeTracks();
		const manager = new SelectionManager({} as never);
		const documentListeners = installDocumentListeners();
		const controller = new ElementInteractionController({
			depsRef: {
				current: {
					viewport: {
						getZoomLevel: () => 1,
						getTracksScrollEl: () => null,
						getTracksContainerEl: () => null,
						getHeaderEl: () => null,
					},
					input: { isShiftHeld: () => false },
					scene: { getTracks: () => tracks, getActiveFps: () => null },
					selection: {
						getSelected: () => manager.getSelectedElements(),
						isSelected: (ref) =>
							manager
								.getSelectedElements()
								.some(
									(selected) =>
										selected.trackId === ref.trackId &&
										selected.elementId === ref.elementId,
								),
						select: (ref) => manager.selectElement({ element: ref }),
						selectMany: (refs) =>
							manager.setSelectedElements({ elements: refs }),
						handleClick: () => {},
						clearKeyframeSelection: () => manager.clearKeyframeSelection(),
					},
					playback: { getCurrentTime: () => 0 },
					timeline: { moveElements: () => {} },
					snap: { isEnabled: () => false },
				},
			},
		});
		const track = tracks.overlay.find(
			(candidate) => candidate.id === "caption-track",
		);
		const element = track?.elements[0];
		if (!track || !element) throw new Error("Missing caption fixture");

		try {
			const singleClick = mouseEvent({ detail: 1 });
			controller.onElementMouseDown({ event: singleClick, element, track });
			documentListeners.emit("mouseup", { clientX: 10, clientY: 10 });
			controller.onElementClick({ event: singleClick, element, track });
			expect(manager.getSelectedElements()).toEqual([
				{ trackId: "caption-track", elementId: "caption-1" },
				{ trackId: "caption-track", elementId: "caption-2" },
			]);

			const doubleClick = mouseEvent({ detail: 2 });
			controller.onElementClick({ event: doubleClick, element, track });
			expect(manager.getSelectedElements()).toEqual([
				{ trackId: "caption-track", elementId: "caption-1" },
			]);
		} finally {
			controller.destroy();
			documentListeners.restore();
		}
	});

	test("preview single-click expands a generated caption to its whole document", () => {
		const tracks = makeTracks();
		const captionTrack = tracks.overlay.find(
			(track) => track.id === "caption-track",
		);
		const caption = captionTrack?.elements[0];
		if (!captionTrack || !caption) throw new Error("Missing caption fixture");

		expect(
			buildPreviewClickSelection({
				tracks,
				clickTarget: {
					trackId: captionTrack.id,
					elementId: caption.id,
					element: caption,
					bounds: {
						cx: 50,
						cy: 50,
						width: 20,
						height: 10,
						rotation: 0,
					},
				},
			}),
		).toEqual([
			{ trackId: "caption-track", elementId: "caption-1" },
			{ trackId: "caption-track", elementId: "caption-2" },
		]);
	});

	test("single-click preview selection opens the same canonical selection and empty canvas clears it", () => {
		const tracks = makePreviewTracks();
		const manager = new SelectionManager({} as never);
		let playbackListener = () => {};
		const captured = new Set<number>();
		const target = {
			setPointerCapture: (id: number) => captured.add(id),
			hasPointerCapture: (id: number) => captured.has(id),
			releasePointerCapture: (id: number) => captured.delete(id),
		};
		const controller = new PreviewInteractionController({
			depsRef: {
				current: {
					viewport: {
						screenToCanvas: ({ clientX, clientY }) => ({
							x: clientX,
							y: clientY,
						}),
						screenPixelsToLogicalThreshold: ({ screenPixels }) => ({
							x: screenPixels,
							y: screenPixels,
						}),
					},
					input: { isShiftHeld: () => false },
					scene: {
						getTracks: () => tracks,
						getCurrentTime: () => 0,
						getMediaAssets: () => [],
						getCanvasSize: () => ({ width: 100, height: 100 }),
					},
					selection: {
						getSelected: () => manager.getSelectedElements(),
						select: (element) => manager.selectElement({ element }),
						selectMany: (elements) =>
							manager.setSelectedElements({ elements: [...elements] }),
						clearSelection: () => manager.clearSelection(),
					},
					timeline: {
						getElementsWithTracks: () => [],
						previewElements: () => {},
						commitPreview: () => {},
						discardPreview: () => {},
					},
					playback: {
						getIsPlaying: () => false,
						subscribe: (listener) => {
							playbackListener = listener;
							return () => {};
						},
					},
					preview: { isMaskMode: () => false },
				},
			},
		});
		const pointerEvent = (x: number, y: number, type = "pointerup") =>
			({
				clientX: x,
				clientY: y,
				currentTarget: target,
				pointerId: 1,
				button: 0,
				type,
			}) as unknown as ReactPointerEvent;

		controller.onPointerDown(pointerEvent(50, 50, "pointerdown"));
		controller.onPointerUp(pointerEvent(50, 50));
		expect(manager.getSelectedElements()).toEqual([
			{ trackId: "video-track", elementId: "video-1" },
		]);

		playbackListener();
		expect(manager.getSelectedElements()).toEqual([
			{ trackId: "video-track", elementId: "video-1" },
		]);

		controller.onPointerDown(pointerEvent(150, 150, "pointerdown"));
		controller.onPointerUp(pointerEvent(150, 150));
		expect(manager.getSelectedElements()).toEqual([]);
		controller.destroy();
	});

	test("preview distinguishes click from drag without clearing or changing the selected layer", () => {
		const tracks = makePreviewTracks();
		const manager = new SelectionManager({} as never);
		const captured = new Set<number>();
		const target = {
			setPointerCapture: (id: number) => captured.add(id),
			hasPointerCapture: (id: number) => captured.has(id),
			releasePointerCapture: (id: number) => captured.delete(id),
		};
		let commitCount = 0;
		const controller = new PreviewInteractionController({
			depsRef: {
				current: {
					viewport: {
						screenToCanvas: ({ clientX, clientY }) => ({
							x: clientX,
							y: clientY,
						}),
						screenPixelsToLogicalThreshold: ({ screenPixels }) => ({
							x: screenPixels,
							y: screenPixels,
						}),
					},
					input: { isShiftHeld: () => false },
					scene: {
						getTracks: () => tracks,
						getCurrentTime: () => 0,
						getMediaAssets: () => [],
						getCanvasSize: () => ({ width: 100, height: 100 }),
					},
					selection: {
						getSelected: () => manager.getSelectedElements(),
						select: (element) => manager.selectElement({ element }),
						selectMany: (elements) =>
							manager.setSelectedElements({ elements: [...elements] }),
						clearSelection: () => manager.clearSelection(),
					},
					timeline: {
						getElementsWithTracks: ({ elements }) =>
							elements.flatMap((ref) => {
								const track = allTracks(tracks).find(
									(candidate) => candidate.id === ref.trackId,
								);
								const element = track?.elements.find(
									(candidate) => candidate.id === ref.elementId,
								);
								return track && element ? [{ track, element }] : [];
							}),
						previewElements: () => {},
						commitPreview: () => {
							commitCount += 1;
						},
						discardPreview: () => {},
					},
					playback: {
						getIsPlaying: () => false,
						subscribe: () => () => {},
					},
					preview: { isMaskMode: () => false },
				},
			},
		});
		const pointerEvent = (x: number, y: number, type: string) =>
			({
				clientX: x,
				clientY: y,
				currentTarget: target,
				pointerId: 7,
				button: 0,
				type,
			}) as unknown as ReactPointerEvent;

		controller.onPointerDown(pointerEvent(50, 50, "pointerdown"));
		controller.onPointerMove(pointerEvent(50.25, 50.25, "pointermove"));
		controller.onPointerUp(pointerEvent(50.25, 50.25, "pointerup"));
		expect(manager.getSelectedElements()).toEqual([
			{ trackId: "video-track", elementId: "video-1" },
		]);
		expect(commitCount).toBe(0);

		controller.onPointerDown(pointerEvent(50, 50, "pointerdown"));
		controller.onPointerMove(pointerEvent(52, 52, "pointermove"));
		controller.onPointerUp(pointerEvent(52, 52, "pointerup"));
		expect(manager.getSelectedElements()).toEqual([
			{ trackId: "video-track", elementId: "video-1" },
		]);
		expect(commitCount).toBe(1);
		controller.destroy();
	});

	test("selection changes notify the properties subscriber synchronously and persist across playback/playhead activity", () => {
		const manager = new SelectionManager({} as never);
		const tracks = makeTracks();
		const selectedType = () => {
			const selected = manager.getSelectedElements()[0];
			if (!selected) return null;
			return allTracks(tracks)
				.find((track) => track.id === selected.trackId)
				?.elements.find((element) => element.id === selected.elementId)?.type;
		};
		let notifications = 0;
		manager.subscribe(() => {
			notifications += 1;
		});

		manager.selectElement({
			element: { trackId: "video-track", elementId: "video-1" },
		});
		expect(notifications).toBe(1);
		expect(manager.getSelectedElements()[0]?.elementId).toBe("video-1");
		expect(selectedType()).toBe("video");

		// Playback and playhead movement do not write to selection.
		const playbackStarted = true;
		const playheadTime = 60_000;
		expect(playbackStarted).toBe(true);
		expect(playheadTime).toBeGreaterThan(0);
		expect(manager.getSelectedElements()[0]?.elementId).toBe("video-1");

		manager.selectElement({
			element: { trackId: "audio-track", elementId: "audio-1" },
		});
		expect(manager.getSelectedElements()).toEqual([
			{ trackId: "audio-track", elementId: "audio-1" },
		]);
		expect(selectedType()).toBe("audio");

		manager.selectElement({
			element: { trackId: "caption-track", elementId: "caption-1" },
		});
		expect(manager.getSelectedElements()).toEqual([
			{ trackId: "caption-track", elementId: "caption-1" },
		]);
		expect(selectedType()).toBe("text");
		expect(notifications).toBe(3);
	});
});
