import { describe, expect, test } from "bun:test";
import {
	normalizeProjectExportFps,
	resolveExportCanvasSize,
	resolveExportFps,
} from "./project-defaults";

describe("project-derived export defaults", () => {
	test("inherits sequence dimensions and frame rate without overrides", () => {
		expect(
			resolveExportCanvasSize({
				projectCanvasSize: { width: 1920, height: 1080 },
				override: null,
			}),
		).toEqual({ width: 1920, height: 1080 });
		expect(resolveExportFps({ projectFps: 60, override: null })).toBe(60);
	});

	test("uses explicit user overrides after selection", () => {
		expect(
			resolveExportCanvasSize({
				projectCanvasSize: { width: 1920, height: 1080 },
				override: { width: 1080, height: 1080 },
			}),
		).toEqual({ width: 1080, height: 1080 });
		expect(resolveExportFps({ projectFps: 60, override: 24 })).toBe(24);
	});

	test("normalizes invalid project frame rates safely", () => {
		expect(normalizeProjectExportFps({ fps: Number.NaN })).toBe(30);
		expect(normalizeProjectExportFps({ fps: 120 })).toBe(60);
		expect(normalizeProjectExportFps({ fps: 0 })).toBe(1);
	});
});
