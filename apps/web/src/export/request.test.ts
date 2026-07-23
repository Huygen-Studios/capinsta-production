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
		expect(request.get("render_mode")).toBe("headless");
	});

	test("serializes full-video exports for the headless worker", () => {
		const request = createExportRequestFormData({
			sourceJobId: "source-job",
			captionsJson: "[]",
			theme: "word_highlight_box",
			styleConfigJson: "{}",
			width: 1080,
			height: 1920,
			fps: 30,
			includeAudio: true,
			quality: "balanced",
			exportMode: "full_video",
			backgroundColor: null,
			durationSeconds: 12.5,
		});

		expect(request.get("export_mode")).toBe("full_video");
		expect(request.get("render_mode")).toBe("headless");
		expect(request.get("include_audio")).toBe("true");
		expect(request.get("duration_override")).toBe("12.5");
	});

	test("serializes imported-caption exports against their source media", () => {
		const request = createExportRequestFormData({
			sourceMediaAssetId: "media-asset-123",
			projectId: "project-123",
			captionsJson: "[]",
			theme: "word_highlight_box",
			styleConfigJson: "{}",
			width: 1080,
			height: 1920,
			fps: 30,
			includeAudio: true,
			quality: "balanced",
			exportMode: "full_video",
			backgroundColor: null,
			durationSeconds: 12.5,
		});

		expect(request.get("source_job_id")).toBeNull();
		expect(request.get("media_asset_id")).toBe("media-asset-123");
		expect(request.get("project_id")).toBe("project-123");
	});
});
