import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { getCapinstaPresetStyle } from "@/capinsta/styles/presetRegistry";
import {
	CAPINSTA_FONT_REGISTRY,
	normalizeCapinstaFontWeight,
	resolveCapinstaFontFace,
	resolveCapinstaFont,
} from "./captionFontRegistry";

describe("Capinsta caption font registry", () => {
	test("resolves Komika Axis aliases to one canonical definition", () => {
		expect(resolveCapinstaFont("Komika Axis")?.id).toBe("komika-axis");
		expect(resolveCapinstaFont("komika-axis")?.cssFamily).toBe("Komika Axis");
		expect(resolveCapinstaFont("KomikaAxis")?.exportFamily).toBe("Komika Axis");
	});

	test("MRBEAST stores the shared Komika Axis family canonically", () => {
		const style = getCapinstaPresetStyle("mrbeast_style");
		expect(style.text.fontFamily).toBe(
			resolveCapinstaFont("Komika Axis")?.cssFamily,
		);
		expect(style.lockup.bigFontFamily).toBe("Komika Axis");
		expect(style.lockup.smallFontFamily).toBe("Komika Axis");
	});

	test("bundled Poppins faces and normalized weights are export-resolvable", () => {
		const poppins = resolveCapinstaFont("Poppins");
		expect(
			resolveCapinstaFontFace({
				definition: poppins!,
				weight: 900,
				style: "normal",
			})?.file,
		).toContain("Poppins-Black.ttf");
		expect(normalizeCapinstaFontWeight("bold")).toBe(700);
		expect(normalizeCapinstaFontWeight(875)).toBe(900);
		expect(CAPINSTA_FONT_REGISTRY.length).toBeGreaterThan(1);
	});

	test("Komika Axis resolves to its stable public asset", () => {
		const definition = resolveCapinstaFont("Komika Axis");
		expect(definition).not.toBeNull();
		expect(
			resolveCapinstaFontFace({
				definition: definition!,
				weight: 900,
				style: "normal",
			})?.file,
		).toBe("KomikaAxis.ttf");
	});

	test("every registered bundled face exists in public caption-fonts", () => {
		for (const definition of CAPINSTA_FONT_REGISTRY) {
			for (const fontFace of definition.faces) {
				expect(
					existsSync(
						path.join(
							process.cwd(),
							"public",
							"caption-fonts",
							...fontFace.file.split("/"),
						),
					),
				).toBe(true);
			}
		}
	});

	test("every preset font resolves to a bundled registry face", () => {
		for (const presetId of [
			"word_highlight_box",
			"attention_punch",
			"apple_cinematic",
			"kinetic_fade",
			"mrbeast_style",
			"modern_minimalist_lockup",
		] as const) {
			const style = getCapinstaPresetStyle(presetId);
			for (const family of [
				style.text.fontFamily,
				style.lockup.bigFontFamily,
				style.lockup.smallFontFamily,
			]) {
				const definition = resolveCapinstaFont(family);
				expect(definition?.faces.length).toBeGreaterThan(0);
			}
		}
	});
});
