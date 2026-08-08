import { describe, expect, test } from "bun:test";
import { buildEstimatedCaptionChunks } from "./caption";

describe("estimated caption interpolation", () => {
	test("is permanently marked unsafe for active-word effects", () => {
		const chunks = buildEstimatedCaptionChunks({
			segments: [{ text: "one two three", start: 1, end: 4 }],
		});
		expect(chunks.length).toBeGreaterThan(0);
		for (const chunk of chunks) {
			expect(chunk.timingSource).toBe("estimated");
			expect(chunk.timingNeedsReview).toBe(true);
			expect(chunk.activeWordEffectsEnabled).toBe(false);
		}
	});
});
