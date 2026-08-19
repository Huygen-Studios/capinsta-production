import { describe, expect, it } from "bun:test";
import {
	CAPINSTA_CAPTION_PRESETS,
	getCapinstaPreset,
	getCapinstaPresetStyle,
} from "./styles/presetRegistry";
import { getCaptionPreset } from "./original/captionStylePresets";
import { buildCaptionPages, segmentsToCaptions } from "./original/captionUtils";
import type { AlignedWord } from "./original/types";
import { normalizeCapinstaCaptionStyle } from "./styles/styleValidation";

describe("Dynamic Punch Caption Preset", () => {
	it("registers dynamic_punch in CAPINSTA_CAPTION_PRESETS with expected defaults", () => {
		const preset = getCapinstaPreset("dynamic_punch");
		expect(preset).toBeDefined();
		expect(preset.id).toBe("dynamic_punch");
		expect(preset.name).toBe("Dynamic Punch");

		const style = preset.style;
		expect(style.text.fontFamily).toBe("Montserrat");
		expect(style.text.fontWeight).toBe(900);
		expect(style.text.color).toBe("#FFFFFF");
		expect(style.activeWord.color).toBe("#00FFFF");

		// Stroke & shadow
		expect(style.outline.width).toBe(8);
		expect(style.outline.color).toBe("#000000");
		expect(style.shadow.enabled).toBe(true);
		expect(style.shadow.blur).toBe(0);
		expect(style.shadow.distance).toBe(6);
		expect(style.shadow.intensity).toBe(2);
		expect(style.shadow.color).toBe("#000000");

		// Center positioning
		expect(style.layout.positionX).toBe(50);
		expect(style.layout.positionY).toBe(46);
		expect(style.layout.maxWidth).toBe(72);

		// Chunking
		expect(style.chunking.targetWordsPerCaption).toBe(1);
		expect(style.chunking.maxWordsPerCaption).toBe(2);
		expect(style.chunking.avoidSingleWordCaptions).toBe(false);
		expect(style.chunking.maxHoldAfterWord).toBe(0);
	});

	it("registers dynamic_punch in original CAPTION_PRESET_REGISTRY", () => {
		const preset = getCaptionPreset("dynamic_punch");
		expect(preset).toBeDefined();
		expect(preset.id).toBe("dynamic_punch");
		expect(preset.name).toBe("Dynamic Punch");
		expect(preset.defaultStyleConfig.fontFamily).toBe("Montserrat");
		expect(preset.defaultStyleConfig.fontWeight).toBe(900);
		expect(preset.defaultStyleConfig.textStrokeWidth).toBe(8);
		expect(preset.defaultStyleConfig.textShadowBlur).toBe(0);
	});

	it("segments transcript into 1-word beats while preserving numeric/time units", () => {
		const words: AlignedWord[] = [
			{ word: "He", start: 0.0, end: 0.2, score: 1 },
			{ word: "wakes", start: 0.22, end: 0.5, score: 1 },
			{ word: "up", start: 0.52, end: 0.7, score: 1 },
			{ word: "at", start: 0.72, end: 0.85, score: 1 },
			{ word: "2:45", start: 0.88, end: 1.4, score: 1 },
			{ word: "in", start: 1.42, end: 1.55, score: 1 },
			{ word: "the", start: 1.57, end: 1.68, score: 1 },
			{ word: "morning", start: 1.7, end: 2.1, score: 1 },
		];

		const preset = getCapinstaPreset("dynamic_punch");
		const pages = buildCaptionPages(words, preset.style.chunking);

		// 2:45 should remain atomic as 1 caption page
		const pageTexts = pages.map((page) => page.map((w) => w.word).join(" "));
		expect(pageTexts).toContain("2:45");

		// Most other pages should be single words
		expect(pages.length).toBeGreaterThanOrEqual(6);
	});

	it("eliminates exit gaps between words when maxHoldAfterWord is 0 or theme is dynamic_punch", () => {
		const words: AlignedWord[] = [
			{ word: "FIRST", start: 0.0, end: 0.3, score: 1 },
			{ word: "SECOND", start: 0.5, end: 0.8, score: 1 },
			{ word: "THIRD", start: 1.0, end: 1.3, score: 1 },
		];

		const segment = { id: "s1", start: 0.0, end: 1.3, text: "FIRST SECOND THIRD", words };
		const captions = segmentsToCaptions([segment], "english", "dynamic_punch");

		expect(captions.length).toBe(3);
		// FIRST caption end should extend to right before SECOND caption start (0.5 - 0.001)
		expect(captions[0].end).toBeCloseTo(0.499, 2);
		expect(captions[1].start).toBe(0.5);
		expect(captions[1].end).toBeCloseTo(0.999, 2);
		expect(captions[2].start).toBe(1.0);
	});

	it("normalizes dynamic_punch style correctly", () => {
		const raw = {
			presetId: "dynamic_punch",
			presetName: "Dynamic Punch",
			text: {
				fontFamily: "Montserrat",
				fontWeight: 900,
				color: "#FFFFFF",
			},
			outline: {
				width: 8,
				color: "#000000",
			},
			shadow: {
				enabled: true,
				blur: 0,
				distance: 4,
				color: "#000000",
			},
		};

		const normalized = normalizeCapinstaCaptionStyle(raw);
		expect(normalized.presetId).toBe("dynamic_punch");
		expect(normalized.text.fontFamily).toBe("Montserrat");
		expect(normalized.text.fontWeight).toBe(900);
		expect(normalized.outline.width).toBe(8);
		expect(normalized.shadow.blur).toBe(0);
	});
});
