import { describe, expect, test } from "bun:test";
import { createExportRequestFormData } from "./request";

describe("export request serialization", () => {
	test("sends the normalized selected graphics background", () => {
		const request = createExportRequestFormData({
			sourceJobId: "source-job",
			captionsJson: "[]",
			theme: "word_highlight_box",
			styleConfigJson: "{}",
			width: 1080,
			height: 1920,
			fps: 60,
			includeAudio: false,
			quality: "balanced",
			exportMode: "captions_solid_background",
			backgroundColor: "00ff00",
			durationSeconds: 1,
		});

		expect(request.get("background_color")).toBe("#00FF00");
		expect(request.get("export_mode")).toBe("captions_solid_background");
		expect(request.get("export_fps")).toBe("60");
	});
});
