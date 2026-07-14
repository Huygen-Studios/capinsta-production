import { describe, expect, test } from "bun:test";
import { validateExportOutput } from "./output-limits";

describe("export output limits", () => {
	test.each([
		{ width: 1920, height: 1080, fps: 60 },
		{ width: 1080, height: 1920, fps: 60 },
		{ width: 720, height: 1280, fps: 24 },
	])("accepts supported output %o", (output) => {
		expect(validateExportOutput(output)).toBeNull();
	});

	test.each([
		{ width: 3840, height: 2160, fps: 30 },
		{ width: 2160, height: 3840, fps: 30 },
		{ width: 1920, height: 1080, fps: 61 },
		{ width: Number.POSITIVE_INFINITY, height: 1080, fps: 30 },
	])("rejects unsupported output %o", (output) => {
		expect(validateExportOutput(output)).not.toBeNull();
	});
});
