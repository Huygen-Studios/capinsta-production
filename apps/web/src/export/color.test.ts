import { describe, expect, test } from "bun:test";
import {
	normalizeExportHexColor,
	resolveExportSceneBackground,
	resolveSolidExportBackground,
} from "./color";

describe("export background color", () => {
	test("normalizes safe six-digit RGB input", () => {
		expect(normalizeExportHexColor({ value: "#00ff00" })).toBe("#00FF00");
		expect(normalizeExportHexColor({ value: "00FF00" })).toBe("#00FF00");
		expect(normalizeExportHexColor({ value: "#123456" })).toBe("#123456");
	});

	test("rejects malformed, alpha, and CSS-function input", () => {
		for (const value of ["", "#00FF0080", "rgb(0,255,0)", "red"])
			expect(normalizeExportHexColor({ value })).toBeNull();
	});

	test("uses the requested opaque color for graphics-layer scenes", () => {
		expect(
			resolveExportSceneBackground({
				exportMode: "captions_solid_background",
				requestedColor: "#00ff00",
				projectBackground: { type: "color", color: "#101014" },
			}),
		).toEqual({ type: "color", color: "#00FF00" });
	});

	test("preserves the project background for full video", () => {
		const projectBackground = { type: "color" as const, color: "#101014" };
		expect(
			resolveExportSceneBackground({
				exportMode: "full_video",
				requestedColor: "#00FF00",
				projectBackground,
			}),
		).toBe(projectBackground);
	});

	test("falls back safely", () => {
		expect(resolveSolidExportBackground({ value: "invalid" })).toBe("#00FF00");
	});
});
