import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import OriginalCaptionRenderer from "./original/CaptionRenderer";
import { getActiveWordIndex } from "./original/captionUtils";
import {
	toOriginalCaption,
	toOriginalCaptionStyleConfig,
} from "./originalAdapter";
import { getCapinstaPresetStyle } from "./styles/presetRegistry";
import type { NeutralCaptionDocument } from "./types";

function buildDocument(): NeutralCaptionDocument {
	return {
		id: "doc-1",
		trackId: "track-1",
		sourceTranscriptRef: {
			version: "capinsta.transcript.v1",
			sourceAssetId: "asset-1",
			sourceAssetName: "source.mp4",
			provider: "test",
		},
		durationSeconds: 2,
		languageMode: "english",
		stylePresetId: "modern_minimalist_lockup",
		style: getCapinstaPresetStyle("modern_minimalist_lockup"),
		clips: [
			{
				id: "clip-1",
				trackId: "track-1",
				start: 0,
				end: 1.8,
				text: "change your life today",
				wordIds: ["w1", "w2", "w3", "w4"],
				stylePresetId: "modern_minimalist_lockup",
				style: getCapinstaPresetStyle("modern_minimalist_lockup"),
				selected: false,
				editable: true,
				manuallyEdited: false,
				timingNeedsReview: false,
				timingSource: "provider",
				sourceClipId: "clip-1",
			},
		],
		words: [
			{
				id: "w1",
				text: "change",
				displayedText: "change",
				start: 0,
				end: 0.4,
				timingSource: "provider",
				sourceWordId: "w1",
			},
			{
				id: "w2",
				text: "your",
				displayedText: "your",
				start: 0.4,
				end: 0.8,
				timingSource: "provider",
				sourceWordId: "w2",
			},
			{
				id: "w3",
				text: "life",
				displayedText: "life",
				start: 0.8,
				end: 1.2,
				timingSource: "provider",
				sourceWordId: "w3",
			},
			{
				id: "w4",
				text: "today",
				displayedText: "today",
				start: 1.2,
				end: 1.6,
				timingSource: "provider",
				sourceWordId: "w4",
			},
		],
		manualEdits: {},
		timing: {
			sourceOfTruth: "words",
			generatedAt: "2026-06-16T00:00:00.000Z",
		},
	};
}

describe("original Capinsta renderer adapter", () => {
	test("uses exact active-word timing boundaries", () => {
		const document = buildDocument();
		const caption = toOriginalCaption({
			document,
			clip: document.clips[0]!,
		});

		expect(getActiveWordIndex(caption.words, 0.399)).toBe(0);
		expect(getActiveWordIndex(caption.words, 0.4)).toBe(1);
		expect(getActiveWordIndex(caption.words, 0.8)).toBe(2);
		expect(getActiveWordIndex(caption.words, 1.6)).toBe(-1);
	});

	test("maps Editorial Lockup to original anchor/support layout fields", () => {
		const style = getCapinstaPresetStyle("modern_minimalist_lockup");
		const original = toOriginalCaptionStyleConfig({ style });

		expect(original.presetName).toBe("Editorial Lockup");
		expect(original.layoutMode).toBe("auto");
		expect(original.bigFontSizePx).toBe(220);
		expect(original.smallFontSizePx).toBe(104);
		expect(original.anchorSizeMultiplier).toBe(1.55);
		expect(original.supportSizeMultiplier).toBe(0.28);
	});

	test("Editorial Lockup renderer does not reveal the whole sentence at once", () => {
		const document = buildDocument();
		const style = getCapinstaPresetStyle("modern_minimalist_lockup");
		const caption = toOriginalCaption({
			document,
			clip: document.clips[0]!,
			style,
		});
		const markup = renderToStaticMarkup(
			<OriginalCaptionRenderer
				captions={[caption]}
				currentTime={0.2}
				fps={30}
				scale={1}
				styleConfig={toOriginalCaptionStyleConfig({ style })}
				canvasSize={{ width: 1080, height: 1920 }}
			/>,
		);

		expect(markup).toContain('data-caption-theme="modern_minimalist_lockup"');
		expect(markup).toContain("visibility:hidden");
		expect(markup).not.toContain("change your life today");
	});
});
