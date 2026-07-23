import { describe, expect, test } from "bun:test";
import { createSpeechWavFileFromMonoPcm } from "./mediabunny";

describe("speech audio extraction", () => {
	test("creates a compact 16 kHz mono PCM WAV", async () => {
		const sourceSampleRate = 44_100;
		const samples = new Float32Array(sourceSampleRate);
		samples[0] = 1;
		samples[1] = -1;

		const file = createSpeechWavFileFromMonoPcm({
			samples,
			sourceSampleRate,
			sourceName: "high-bitrate-video.mp4",
		});
		const bytes = new Uint8Array(await file.arrayBuffer());
		const view = new DataView(bytes.buffer);

		expect(file.name).toBe("high-bitrate-video.caption.wav");
		expect(file.type).toBe("audio/wav");
		expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
		expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(16_000);
		expect(view.getUint32(28, true)).toBe(32_000);
		expect(view.getUint32(40, true)).toBe(32_000);
		expect(file.size).toBe(32_044);
	});
});
