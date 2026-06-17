/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Test fixtures use branded media-time numbers without loading the wasm module. */
import { describe, expect, test } from "bun:test";
import {
	createCapinstaExportCaptionManifest,
	getActiveCapinstaExportWordIdsAtTime,
	getActiveCapinstaTextRenderDataAtTime,
	getCapinstaTextRenderDataForElement,
	isCapinstaExportCarrierTextElement,
} from "./exportRender";
import {
	capinstaTranscriptToCaptionDocument,
	updateCaptionClipText,
	updateCaptionClipTiming,
} from "./adapter";
import { sampleCapinstaTranscriptV1 } from "./sampleTranscript";
import { CAPINSTA_CAPTION_PRESETS } from "./styles/presetRegistry";
import type { CapinstaCaptionDocumentRecord } from "./types";
import type { TextElement } from "@/timeline";
import { renderCapinstaWysiwygExportCaption } from "./export/capinstaWysiwygExportRenderer";

function recordForDocument(
	document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1),
): CapinstaCaptionDocumentRecord {
	return {
		document,
		openCutTrackId: "caption-track",
		importedAt: "2026-06-16T00:00:00.000Z",
	};
}

function elementForClip({
	document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1),
	clipIndex = 0,
	content,
}: {
	document?: ReturnType<typeof capinstaTranscriptToCaptionDocument>;
	clipIndex?: number;
	content?: string;
} = {}): TextElement {
	const clip = document.clips[clipIndex]!;
	return {
		id: "text-001",
		type: "text",
		name: "Caption 1",
		startTime: 0 as TextElement["startTime"],
		duration: 1 as TextElement["duration"],
		trimStart: 0 as TextElement["trimStart"],
		trimEnd: 0 as TextElement["trimEnd"],
		params: { content: content ?? clip.text },
		capinstaDocumentId: document.id,
		capinstaClipId: clip.id,
	};
}

function createTestCanvasContext() {
	return {
		font: "",
		textAlign: "left",
		textBaseline: "middle",
		fillStyle: "#000000",
		strokeStyle: "#000000",
		lineWidth: 1,
		lineJoin: "round",
		shadowColor: "transparent",
		shadowOffsetX: 0,
		shadowOffsetY: 0,
		shadowBlur: 0,
		save() {},
		restore() {},
		translate() {},
		rotate() {},
		scale() {},
		beginPath() {},
		roundRect() {},
		fill() {},
		stroke() {},
		fillText() {},
		strokeText() {},
		measureText(text: string) {
			return { width: text.length * 24 };
		},
	} as unknown as OffscreenCanvasRenderingContext2D;
}

describe("Capinsta export render helpers", () => {
	test("creates one static caption manifest entry per Capinsta clip", () => {
		const record = recordForDocument();
		const manifest = createCapinstaExportCaptionManifest({
			records: [record],
		});
		const firstClip = record.document.clips[0]!;

		expect(manifest).toHaveLength(2);
		expect(manifest[0]).toMatchObject({
			clipId: firstClip.id,
			start: firstClip.start,
			end: firstClip.end,
			text: firstClip.text,
		});
	});

	test("selects active export words using inclusive start and exclusive end", () => {
		const record = recordForDocument();
		const renderData = getCapinstaTextRenderDataForElement({
			records: [record],
			element: elementForClip({ document: record.document }),
		});

		expect(
			getActiveCapinstaExportWordIdsAtTime({
				renderData,
				timeSeconds: record.document.words[0]!.start,
			}),
		).toEqual(["word-001"]);
		expect(
			getActiveCapinstaExportWordIdsAtTime({
				renderData,
				timeSeconds: record.document.words[0]!.end,
			}),
		).toEqual([]);
	});

	test("keeps active-word export when timing needs review but word timings exist", () => {
		const record = recordForDocument();
		const renderData = getCapinstaTextRenderDataForElement({
			records: [record],
			element: elementForClip({ document: record.document, clipIndex: 1 }),
		});

		expect(renderData?.timingNeedsReview).toBe(true);
		expect(
			getActiveCapinstaExportWordIdsAtTime({
				renderData,
				timeSeconds: 2.8,
			}),
		).toEqual(["word-005"]);
	});

	test("returns no render data when metadata is missing", () => {
		expect(
			getCapinstaTextRenderDataForElement({
				records: [recordForDocument()],
			element: {
				...elementForClip(),
				capinstaDocumentId: undefined,
					capinstaClipId: undefined,
				},
			}),
		).toBeNull();
	});

	test("uses edited same-word-count text in export words", () => {
		const baseDocument = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1);
		const clipId = baseDocument.clips[0]!.id;
		const document = updateCaptionClipText(
			baseDocument,
			clipId,
			"Make the clean cut",
		);
		const renderData = getCapinstaTextRenderDataForElement({
			records: [recordForDocument(document)],
			element: elementForClip({ document, content: "Make the clean cut" }),
		});

		expect(renderData?.words.map((word) => word.text)).toEqual([
			"Make",
			"the",
			"clean",
			"cut",
		]);
		expect(renderData?.timingNeedsReview).toBe(false);
	});

	test("active export reads Capinsta clip text instead of stale OpenCut element text", () => {
		const baseDocument = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1);
		const clipId = baseDocument.clips[0]!.id;
		const document = updateCaptionClipText(
			baseDocument,
			clipId,
			"preview owned caption text",
		);
		const renderData = getActiveCapinstaTextRenderDataAtTime({
			records: [recordForDocument(document)],
			timeSeconds: document.clips[0]!.start,
			canvasSize: { width: 1080, height: 1920 },
		});

		expect(renderData?.clipText).toBe("preview owned caption text");
		expect(renderData?.renderText.replace(/\s+/g, " ")).toContain(
			"preview owned caption",
		);
		expect(renderData?.renderText).not.toContain("CAN next");
		expect(renderData?.renderText).not.toContain("caption=");
	});

	test("marks Capinsta carrier text for default OpenCut export bypass", () => {
		const record = recordForDocument();
		const captionElement = elementForClip({
			document: record.document,
			content: "stale OpenCut carrier text",
		});
		const normalElement: TextElement = {
			...captionElement,
			id: "normal-opencut-text",
			capinstaDocumentId: undefined,
			capinstaClipId: undefined,
		};

		expect(
			isCapinstaExportCarrierTextElement({
				element: captionElement,
				capinstaElementIds: new Set([captionElement.id]),
			}),
		).toBe(true);
		expect(
			isCapinstaExportCarrierTextElement({
				element: normalElement,
				capinstaElementIds: new Set([captionElement.id]),
			}),
		).toBe(false);
		expect(
			isCapinstaExportCarrierTextElement({
				element: normalElement,
				trackId: record.openCutTrackId,
				capinstaTrackIds: new Set([record.openCutTrackId]),
			}),
		).toBe(true);
	});

	test("uses moved caption timing for active-word export", () => {
		const baseDocument = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1);
		const clip = baseDocument.clips[0]!;
		const document = updateCaptionClipTiming(
			baseDocument,
			clip.id,
			1.42,
			1.42 + (clip.end - clip.start),
		);
		const renderData = getCapinstaTextRenderDataForElement({
			records: [recordForDocument(document)],
			element: elementForClip({ document }),
		});

		expect(
			getActiveCapinstaExportWordIdsAtTime({
				renderData,
				timeSeconds: 1.42,
			}),
		).toEqual(["word-001"]);
		expect(
			getActiveCapinstaExportWordIdsAtTime({
				renderData,
				timeSeconds: 0.42,
			}),
		).toEqual([]);
	});

	test("does not duplicate manifest entries for repeated records", () => {
		const record = recordForDocument();
		const manifest = createCapinstaExportCaptionManifest({
			records: [record, record],
		});

		expect(manifest).toHaveLength(2);
	});

	test("uses Capinsta clip style for active-word export color", () => {
		const document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1);
		const clipId = document.clips[0]!.id;
		const renderData = getCapinstaTextRenderDataForElement({
			records: [
				recordForDocument({
					...document,
					clips: document.clips.map((clip) =>
						clip.id === clipId
							? {
									...clip,
									style: {
										...clip.style!,
										activeWord: {
											...clip.style!.activeWord,
											color: "#ff00ff",
										},
									},
								}
							: clip,
					),
				}),
			],
			element: elementForClip({ document }),
		});

		expect(renderData?.activeWordColor).toBe("#ff00ff");
		expect(renderData?.style.textParams.color).toBe("#FFFFFF");
	});

	test("WYSIWYG export renderer reports the same preset and active-word color as preview config", () => {
		const record = recordForDocument();
		const renderData = getCapinstaTextRenderDataForElement({
			records: [record],
			element: elementForClip({ document: record.document }),
			canvasSize: { width: 1080, height: 1920 },
		});
		const ctx = createTestCanvasContext();
		if (!renderData) throw new Error("missing render data");

		const result = renderCapinstaWysiwygExportCaption({
			ctx,
			renderData,
			activeWordIds: ["word-001"],
			canvasSize: { width: 1080, height: 1920 },
		});

		expect(result.debug.rendererPath).toBe("rendered_capinsta_wysiwyg");
		expect(result.debug.rendererStrategy).toBe("word_highlight_box");
		expect(result.debug.presetId).toBe("word_highlight_box");
		expect(result.debug.activeWordColor).toBe("#FFD43B");
		expect(result.debug.activeWordIds).toEqual(["word-001"]);
		expect(result.debug.box.width).toBeGreaterThan(0);
	});

	test("WYSIWYG export dispatches each Capinsta preset to a matching renderer strategy", () => {
		const expectedStrategies = new Map([
			["word_highlight_box", "word_highlight_box"],
			["attention_punch", "attention_punch"],
			["apple_cinematic", "apple_cinematic"],
			["kinetic_fade", "kinetic_fade"],
			["mrbeast_style", "mrbeast_style"],
			["modern_minimalist_lockup", "modern_minimalist_lockup"],
		]);

		for (const preset of CAPINSTA_CAPTION_PRESETS) {
			const document = capinstaTranscriptToCaptionDocument({
				...sampleCapinstaTranscriptV1,
				stylePreset: {
					...sampleCapinstaTranscriptV1.stylePreset,
					id: preset.id,
					name: preset.name,
				},
			});
			const renderData = getCapinstaTextRenderDataForElement({
				records: [recordForDocument(document)],
				element: elementForClip({ document }),
				canvasSize: { width: 1080, height: 1920 },
			});
			if (!renderData) throw new Error("missing render data");
			const result = renderCapinstaWysiwygExportCaption({
				ctx: createTestCanvasContext(),
				renderData,
				activeWordIds: [document.words[0]!.id],
				timeSeconds: document.words[0]!.start,
				canvasSize: { width: 1080, height: 1920 },
			});

			expect(result.debug.rendererStrategy).toBe(
				expectedStrategies.get(preset.id),
			);
		}
	});

	test("exports OpenCut-safe font units instead of raw Capinsta preset sizes", () => {
		const document = capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1);
		const renderData = getCapinstaTextRenderDataForElement({
			records: [recordForDocument(document)],
			element: elementForClip({ document }),
			canvasSize: { width: 1080, height: 1920 },
		});

		expect(renderData?.style.textParams.fontSize).toBeLessThan(12);
		expect(renderData?.style.canvasFontSizePx).toBeLessThanOrEqual(268.8);
	});

	test("export layout wraps to maxWidth and maxLines", () => {
		const document = updateCaptionClipText(
			capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1),
			capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1).clips[0]!.id,
			"this is a much longer caption that must wrap instead of overflowing the video frame",
		);
		const renderData = getCapinstaTextRenderDataForElement({
			records: [recordForDocument(document)],
			element: elementForClip({ document }),
			canvasSize: { width: 360, height: 640 },
		});
		const lines = renderData?.renderText.split("\n") ?? [];

		expect(lines.length).toBeLessThanOrEqual(2);
		expect(renderData?.style.maxWidthPx).toBeLessThanOrEqual(360);
		expect(renderData?.renderText).not.toContain("caption=");
		expect(renderData?.renderText).not.toContain("word=");
	});

	test("all six presets fit safely in 9:16 export canvas", () => {
		for (const preset of CAPINSTA_CAPTION_PRESETS) {
			const document = capinstaTranscriptToCaptionDocument({
				...sampleCapinstaTranscriptV1,
				stylePreset: {
					...sampleCapinstaTranscriptV1.stylePreset,
					id: preset.id,
					name: preset.name,
				},
			});
			const renderData = getCapinstaTextRenderDataForElement({
				records: [recordForDocument(document)],
				element: elementForClip({ document }),
				canvasSize: { width: 1080, height: 1920 },
			});
			const scaleX = Number(renderData?.style.textParams["transform.scaleX"] ?? 1);
			const maxRenderedLineHeight =
				(renderData?.style.canvasFontSizePx ?? 0) *
				scaleX *
				Number(renderData?.style.textParams.lineHeight ?? 1);

			expect(renderData?.style.canvasFontSizePx).toBeLessThanOrEqual(384);
			expect(maxRenderedLineHeight).toBeLessThanOrEqual(1920 * 0.22);
			expect(renderData?.style.maxWidthPx).toBeLessThanOrEqual(1080);
			expect(renderData?.renderText).not.toContain("caption=");
			expect(renderData?.renderText).not.toContain("word=");
		}
	});

	test("all six presets fit safely in 16:9 export canvas", () => {
		for (const preset of CAPINSTA_CAPTION_PRESETS) {
			const document = capinstaTranscriptToCaptionDocument({
				...sampleCapinstaTranscriptV1,
				stylePreset: {
					...sampleCapinstaTranscriptV1.stylePreset,
					id: preset.id,
					name: preset.name,
				},
			});
			const renderData = getCapinstaTextRenderDataForElement({
				records: [recordForDocument(document)],
				element: elementForClip({ document }),
				canvasSize: { width: 1920, height: 1080 },
			});
			const scaleX = Number(renderData?.style.textParams["transform.scaleX"] ?? 1);
			const maxRenderedLineHeight =
				(renderData?.style.canvasFontSizePx ?? 0) *
				scaleX *
				Number(renderData?.style.textParams.lineHeight ?? 1);

			expect(renderData?.style.canvasFontSizePx).toBeLessThanOrEqual(216);
			expect(maxRenderedLineHeight).toBeLessThanOrEqual(1080 * 0.22);
			expect(renderData?.style.maxWidthPx).toBeLessThanOrEqual(1920);
		}
	});
});
