/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Test file */
import { describe, expect, test } from "bun:test";
import {
	normalizeHexColor,
	resolveCaptionsOnlyBackground,
	resolveRenderBackground,
	isCaptionsOnlyMode,
	CAPTIONS_ONLY_DEFAULT_BACKGROUND,
} from "./renderColor";

describe("renderColor", () => {
	describe("normalizeHexColor", () => {
		test("uppercases valid 6-digit hex", () => {
			expect(normalizeHexColor("#00FF00")).toBe("#00FF00");
			expect(normalizeHexColor("#00ff00")).toBe("#00FF00");
			expect(normalizeHexColor("#abcdef")).toBe("#ABCDEF");
		});

		test("expands 3-digit shorthand", () => {
			expect(normalizeHexColor("#0F0")).toBe("#00FF00");
			expect(normalizeHexColor("#abc")).toBe("#AABBCC");
		});

		test("adds # prefix when missing", () => {
			expect(normalizeHexColor("00FF00")).toBe("#00FF00");
			expect(normalizeHexColor("abc123")).toBe("#ABC123");
		});

		test("returns null for null/undefined/empty", () => {
			expect(normalizeHexColor(null)).toBeNull();
			expect(normalizeHexColor(undefined)).toBeNull();
			expect(normalizeHexColor("")).toBeNull();
			expect(normalizeHexColor("   ")).toBeNull();
		});

		test("returns null for invalid values", () => {
			expect(normalizeHexColor("red")).toBeNull();
			expect(normalizeHexColor("#gggggg")).toBeNull();
			expect(normalizeHexColor("#12345")).toBeNull();
			expect(normalizeHexColor("hello")).toBeNull();
		});

		test("white is valid (explicit user selection)", () => {
			expect(normalizeHexColor("#FFFFFF")).toBe("#FFFFFF");
			expect(normalizeHexColor("#ffffff")).toBe("#FFFFFF");
		});

		test("black is valid", () => {
			expect(normalizeHexColor("#000000")).toBe("#000000");
		});

		test("custom colors pass through", () => {
			expect(normalizeHexColor("#7C3AED")).toBe("#7C3AED");
		});
	});

	describe("resolveCaptionsOnlyBackground", () => {
		test("valid hex passes through", () => {
			expect(resolveCaptionsOnlyBackground("#00FF00")).toBe("#00FF00");
			expect(resolveCaptionsOnlyBackground("#000000")).toBe("#000000");
			expect(resolveCaptionsOnlyBackground("#7C3AED")).toBe("#7C3AED");
		});

		test("white passes through (explicit selection)", () => {
			expect(resolveCaptionsOnlyBackground("#FFFFFF")).toBe("#FFFFFF");
		});

		test("null falls back to green default", () => {
			expect(resolveCaptionsOnlyBackground(null)).toBe(
				CAPTIONS_ONLY_DEFAULT_BACKGROUND,
			);
		});

		test("empty falls back to green default", () => {
			expect(resolveCaptionsOnlyBackground("")).toBe(
				CAPTIONS_ONLY_DEFAULT_BACKGROUND,
			);
		});

		test('"transparent" falls back to green default', () => {
			expect(resolveCaptionsOnlyBackground("transparent")).toBe(
				CAPTIONS_ONLY_DEFAULT_BACKGROUND,
			);
		});

		test("invalid hex falls back to green default", () => {
			expect(resolveCaptionsOnlyBackground("not-a-color")).toBe(
				CAPTIONS_ONLY_DEFAULT_BACKGROUND,
			);
		});
	});

	describe("resolveRenderBackground", () => {
		test("captions_only mode: valid hex passes through", () => {
			expect(resolveRenderBackground("captions_only", "#00FF00")).toBe(
				"#00FF00",
			);
		});

		test("captions_only mode: null falls back to green", () => {
			expect(resolveRenderBackground("captions_only", null)).toBe(
				CAPTIONS_ONLY_DEFAULT_BACKGROUND,
			);
		});

		test("captions_solid_background mode: same behavior", () => {
			expect(
				resolveRenderBackground("captions_solid_background", "#000000"),
			).toBe("#000000");
			expect(
				resolveRenderBackground("captions_solid_background", null),
			).toBe(CAPTIONS_ONLY_DEFAULT_BACKGROUND);
		});

		test("captions_only_solid_background mode: same behavior", () => {
			expect(
				resolveRenderBackground("captions_only_solid_background", "#000000"),
			).toBe("#000000");
			expect(
				resolveRenderBackground("captions_only_solid_background", null),
			).toBe(CAPTIONS_ONLY_DEFAULT_BACKGROUND);
		});

		test("full_video mode: valid hex passes through", () => {
			expect(resolveRenderBackground("full_video", "#101010")).toBe(
				"#101010",
			);
		});

		test("full_video mode: null becomes transparent", () => {
			expect(resolveRenderBackground("full_video", null)).toBe("transparent");
		});

		test("null renderMode treated as full_video", () => {
			expect(resolveRenderBackground(null, "#00FF00")).toBe("#00FF00");
			expect(resolveRenderBackground(null, null)).toBe("transparent");
		});
	});

	describe("isCaptionsOnlyMode", () => {
		test("recognizes all captions-only variants", () => {
			expect(isCaptionsOnlyMode("captions_only")).toBe(true);
			expect(isCaptionsOnlyMode("captions_only_solid_background")).toBe(true);
			expect(isCaptionsOnlyMode("captions_solid_background")).toBe(true);
		});

		test("full_video is not captions-only", () => {
			expect(isCaptionsOnlyMode("full_video")).toBe(false);
		});

		test("null/undefined returns false", () => {
			expect(isCaptionsOnlyMode(null)).toBe(false);
			expect(isCaptionsOnlyMode(undefined)).toBe(false);
		});
	});
});
