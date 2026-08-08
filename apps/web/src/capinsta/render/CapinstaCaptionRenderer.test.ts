import { describe, expect, test } from "bun:test";
import { resolveCaptionTransition } from "./CapinstaCaptionRenderer";

describe("resolveCaptionTransition", () => {
	test("disables CSS transitions for deterministic export frames", () => {
		expect(
			resolveCaptionTransition({ renderMode: "export", isPlaying: false }),
		).toBe(false);
		expect(
			resolveCaptionTransition({ renderMode: "export", isPlaying: true }),
		).toBe(false);
	});

	test("keeps existing preview transition semantics", () => {
		expect(
			resolveCaptionTransition({ renderMode: "preview", isPlaying: false }),
		).toBe(true);
		expect(
			resolveCaptionTransition({ renderMode: "preview", isPlaying: true }),
		).toBe(false);
	});
});

