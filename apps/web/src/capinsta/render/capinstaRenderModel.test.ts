import { describe, expect, test } from "bun:test";
import { capinstaTranscriptToCaptionDocument } from "../adapter";
import {
	createCapinstaCaptionTimingIndex,
} from "../captionTimingIndex";
import { sampleCapinstaTranscriptV1 } from "../sampleTranscript";
import type { CapinstaCaptionDocumentRecord } from "../types";
import {
	createCapinstaRenderModelFromExportData,
	createCapinstaRenderModelFromIndex,
} from "./capinstaRenderModel";

function buildRecord(): CapinstaCaptionDocumentRecord {
	return {
		document: capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1),
		openCutTrackId: "caption-track",
		importedAt: "2026-06-15T10:00:00.000Z",
	};
}

describe("Capinsta render model", () => {
	test("creates a single preview render model from the indexed active caption", () => {
		const record = buildRecord();
		const index = createCapinstaCaptionTimingIndex({ records: [record] });
		const firstWord = record.document.words[0]!;
		const model = createCapinstaRenderModelFromIndex({
			index,
			timeSeconds: firstWord.start,
			rendererPath: "rendered_capinsta_preview",
			viewport: { width: 1080, height: 1920 },
			skippedOpenCutTextIds: ["carrier-text"],
			skippedCapinstaTrackIds: ["caption-track"],
		});

		expect(model?.clip.id).toBe(record.document.clips[0]!.id);
		expect(model?.activeWordIds).toEqual([firstWord.id]);
		expect(model?.manifest.rendererPath).toBe("rendered_capinsta_preview");
		expect(model?.manifest.text).toBe(record.document.clips[0]!.text);
		expect(model?.manifest.activeWordColor).toBe(model?.activeWordColor);
		expect(model?.manifest.skippedOpenCutTextIds).toEqual(["carrier-text"]);
		expect(model?.manifest.skippedCapinstaTrackIds).toEqual(["caption-track"]);
		expect(model?.manifest.finalFontSize).toBeGreaterThan(0);
	});

	test("export render model preserves preview text, active word, preset, and highlight color", () => {
		const record = buildRecord();
		const clip = record.document.clips[0]!;
		const words = clip.wordIds.map((wordId) => record.document.words.find((word) => word.id === wordId)!);
		const activeWord = words[0]!;
		const previewModel = createCapinstaRenderModelFromIndex({
			index: createCapinstaCaptionTimingIndex({ records: [record] }),
			timeSeconds: activeWord.start,
			rendererPath: "rendered_capinsta_preview",
			viewport: { width: 1080, height: 1920 },
		});
		const exportModel = createCapinstaRenderModelFromExportData({
			renderData: {
				documentId: record.document.id,
				clipId: clip.id,
				clipText: clip.text,
				renderText: clip.text,
				wordIds: [...clip.wordIds],
				words: words.map((word) => ({
					id: word.id,
					text: word.displayedText || word.text,
					start: word.start,
					end: word.end,
				})),
				timingNeedsReview: false,
				activeWordColor: previewModel!.activeWordColor,
				style: {
					textColor: previewModel!.normalizedStyleConfig.textColor,
					textParams: {},
					canvasFontSizePx: 48,
					maxWidthPx: 800,
					maxLines: 2,
					activeWordColor: previewModel!.activeWordColor,
					useActiveWordHighlight: true,
				},
				captionStyle: previewModel!.captionStyle,
			},
			activeWordIds: [activeWord.id],
			rendererPath: "rendered_capinsta_wysiwyg",
			viewport: { width: 1080, height: 1920 },
		});

		expect(exportModel.text).toBe(previewModel?.text);
		expect(exportModel.activeWordId).toBe(previewModel?.activeWordId);
		expect(exportModel.presetId).toBe(previewModel?.presetId);
		expect(exportModel.activeWordColor).toBe(previewModel?.activeWordColor);
		expect(exportModel.manifest.rendererPath).toBe("rendered_capinsta_wysiwyg");
	});
});
