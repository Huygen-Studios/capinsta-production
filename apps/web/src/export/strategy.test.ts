import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CAPINSTA_EXPORT_STRATEGY,
	resolveCapinstaExportRoute,
	resolveCapinstaExportStrategy,
} from "./strategy";

describe("CapInsta export strategy", () => {
	test("defaults to the headless Playwright worker", () => {
		expect(resolveCapinstaExportStrategy()).toBe(
			DEFAULT_CAPINSTA_EXPORT_STRATEGY,
		);
		expect(resolveCapinstaExportStrategy({ configured: " HEADLESS " })).toBe(
			"headless",
		);
	});

	test("rejects unknown strategies instead of silently falling back", () => {
		expect(() =>
			resolveCapinstaExportStrategy({ configured: "browser" }),
		).toThrow('Unsupported CapInsta export strategy "browser"');
	});

	test("rejects the legacy unimplemented ForeignObject fallback", () => {
		expect(() =>
			resolveCapinstaExportStrategy({
				legacyForeignObjectFallback: "TRUE",
			}),
		).toThrow(
			"NEXT_PUBLIC_CAPINSTA_EXPORT_FALLBACK_FOREIGNOBJECT is no longer supported",
		);
	});

	test("routes every captioned export mode through the headless worker", () => {
		for (const exportMode of [
			"full_video",
			"captions_solid_background",
		] as const) {
			expect(
				resolveCapinstaExportRoute({
					exportMode,
					captionRecordCount: 1,
					strategy: "headless",
				}),
			).toBe("headless-worker");
		}
	});

	test("keeps caption-free projects on the browser scene exporter", () => {
		expect(
			resolveCapinstaExportRoute({
				exportMode: "full_video",
				captionRecordCount: 0,
				strategy: "headless",
			}),
		).toBe("browser-scene");
	});
});
