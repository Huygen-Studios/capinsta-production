import { describe, expect, test } from "bun:test";
import { getUnsupportedVideoDescription } from "./unsupported-video-description";

describe("getUnsupportedVideoDescription", () => {
	test("does not ask users to convert H.264/AVC into H.264", () => {
		const description = getUnsupportedVideoDescription({ codec: "avc" });

		expect(description).toContain("H.264/AVC");
		expect(description).toContain("browser-compatible H.264 profile");
		expect(description).not.toContain("Convert it to H.264 MP4 and reimport it");
	});

	test("keeps the HEVC browser guidance", () => {
		expect(getUnsupportedVideoDescription({ codec: "hevc" })).toContain(
			"try importing it in Safari",
		);
	});

	test("keeps generic guidance for other unsupported codecs", () => {
		expect(getUnsupportedVideoDescription({ codec: "vp9" })).toContain(
			"Convert it to H.264 MP4 and reimport it",
		);
	});
});
