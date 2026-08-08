import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CAPTION_CHUNKING_CONFIG,
	alignedWordsToCaptions,
	buildCaptionPages,
	getActiveWordIndex,
} from "./original/captionUtils";
import type { AlignedWord } from "./original/types";

const words: AlignedWord[] = [
	{ word: "spends", displayedWord: "spends", start: 0.5, end: 0.9 },
	{ word: "around", displayedWord: "around", start: 0.9, end: 1.2 },
	{ word: "22", displayedWord: "22", start: 2.4, end: 2.65 },
	{ word: "lakh", displayedWord: "lakh", start: 2.66, end: 2.9 },
	{ word: "crore", displayedWord: "crore", start: 2.91, end: 3.2 },
];

describe("pause-aware caption timing", () => {
	test("alignedWordsToCaptions splits immediately at a speaker pause", () => {
		const captions = alignedWordsToCaptions(words, "english", "word_highlight_box", {
			...DEFAULT_CAPTION_CHUNKING_CONFIG,
			pauseSplitThreshold: 0.45,
			maxHoldAfterWord: 0,
		});

		expect(captions.map((caption) => caption.text)).toEqual([
			"spends around",
			"22 lakh crore",
		]);
		expect(captions[0]!.end).toBeLessThanOrEqual(1.2);
		expect(captions[1]!.start).toBeGreaterThanOrEqual(2.4);
	});

	test("final caption-page cleanup never merges across a pause", () => {
		const pages = buildCaptionPages(words, {
			...DEFAULT_CAPTION_CHUNKING_CONFIG,
			minWordsPerCaption: 3,
			avoidSingleWordCaptions: true,
			pauseSplitThreshold: 0.45,
		});

		expect(pages.map((page) => page.map((word) => word.word).join(" "))).toEqual([
			"spends around",
			"22 lakh crore",
		]);
	});

	test("caption text preserves spaces between rendered words", () => {
		const [caption] = alignedWordsToCaptions(words.slice(0, 2));
		expect(caption?.text).toBe("spends around");
		expect(caption?.text).not.toContain("spendsaround");
	});

	test("active word is absent during silence and before a future word starts", () => {
		expect(getActiveWordIndex(words, 1.8)).toBe(-1);
		expect(getActiveWordIndex(words, 2.39)).toBe(-1);
		expect(getActiveWordIndex(words, 2.4)).toBe(2);
	});
});
