import { describe, expect, test } from "bun:test";
import { getCapinstaPresetStyle } from "@/capinsta/styles/presetRegistry";
import {
	CAPINSTA_FONT_REGISTRY,
	normalizeCapinstaFontWeight,
	resolveCaptionFontBaseUrl,
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
		expect(poppins?.sources[900]).toContain("Poppins-Black.ttf");
		expect(normalizeCapinstaFontWeight("bold")).toBe(700);
		expect(normalizeCapinstaFontWeight(875)).toBe(900);
		expect(CAPINSTA_FONT_REGISTRY.length).toBeGreaterThan(1);
	});

	test("headless render pages load fonts from their own backend origin", () => {
		expect(
			resolveCaptionFontBaseUrl({
				configuredBase: "https://api.capinsta.huygenstudios.com",
				locationOrigin: "http://127.0.0.1:10000",
				locationPathname: "/render.html",
			}),
		).toBe("http://127.0.0.1:10000");
		expect(
			resolveCaptionFontBaseUrl({
				configuredBase: "https://api.capinsta.huygenstudios.com",
				locationOrigin: "https://capinsta.huygenstudios.com",
				locationPathname: "/editor/project",
			}),
		).toBe("https://api.capinsta.huygenstudios.com");
	});
});
