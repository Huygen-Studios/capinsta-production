import { describe, expect, test } from "bun:test";
import { captionTimeSeconds } from "./CapInstaCaptionLayer";

describe("caption composition time", () => {
	test("is derived only from the current frame and FPS", () => {
		expect(captionTimeSeconds(0, 30)).toBe(0);
		expect(captionTimeSeconds(75, 30)).toBe(2.5);
		expect(captionTimeSeconds(144, 24)).toBe(6);
	});
});
