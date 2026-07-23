import { afterEach, describe, expect, test } from "bun:test";
import {
	clearCaptionAudioSessionCacheForTests,
	ensureAudioForCaptions,
} from "./audioForCaptions";
import type { MediaAsset } from "@/media/types";

function buildFile({ name, type }: { name: string; type: string }): File {
	return new File(["test"], name, { type });
}

afterEach(() => {
	clearCaptionAudioSessionCacheForTests();
});

describe("ensureAudioForCaptions", () => {
	test("preserves the zero point of a rendered timeline selection", async () => {
		const file = buildFile({ name: "timeline.wav", type: "audio/wav" });
		const audio = await ensureAudioForCaptions({
			videoAssetId: "timeline",
			getAssets: () => [],
			renderedTimelineAudio: {
				file,
				name: file.name,
				duration: 5,
				timelineOffsetUs: 6_500_000,
				timelineDurationUs: 30_000_000,
				selection: true,
			},
		});

		expect(audio.audioOrigin).toBe("rendered_selection");
		expect(audio.timelineOffsetUs).toBe(6_500_000);
		expect(audio.timelineDurationUs).toBe(30_000_000);
	});

	test("reuses an existing extracted audio asset", async () => {
		const assets: MediaAsset[] = [
			{
				id: "video-1",
				name: "clip.mp4",
				type: "video",
				file: buildFile({ name: "clip.mp4", type: "video/mp4" }),
				duration: 4,
				extractedAudioAssetId: "audio-1",
			},
			{
				id: "audio-1",
				name: "clip.wav",
				type: "audio",
				file: buildFile({ name: "clip.wav", type: "audio/wav" }),
				duration: 4,
			},
		];

		const audio = await ensureAudioForCaptions({
			videoAssetId: "video-1",
			getAssets: () => assets,
		});

		expect(audio.assetId).toBe("audio-1");
		expect(audio.wasReused).toBe(true);
	});

	test("extracts compact speech audio once and reuses it in the session", async () => {
		const assets: MediaAsset[] = [
			{
				id: "video-1",
				name: "clip.mp4",
				type: "video",
				file: buildFile({ name: "clip.mp4", type: "video/mp4" }),
				duration: 4,
			},
		];
		const metadataUpdates: unknown[] = [];
		let extractionCount = 0;
		const extractedFile = buildFile({
			name: "clip.caption.wav",
			type: "audio/wav",
		});

		const first = await ensureAudioForCaptions({
			videoAssetId: "video-1",
			getAssets: () => assets,
			cacheAudioMetadata: (metadata) => metadataUpdates.push(metadata),
			extractAudioFile: async ({ file, sourceName }) => {
				extractionCount += 1;
				expect(file).toBe(assets[0]!.file);
				expect(sourceName).toBe("clip.mp4");
				return extractedFile;
			},
		});
		const second = await ensureAudioForCaptions({
			videoAssetId: "video-1",
			getAssets: () => assets,
			cacheAudioMetadata: (metadata) => metadataUpdates.push(metadata),
			extractAudioFile: async () => {
				throw new Error("cached audio should be reused");
			},
		});

		expect(first.assetId).toBe("video-1-caption-audio");
		expect(first.file).toBe(extractedFile);
		expect(first.wasReused).toBe(false);
		expect(second.assetId).toBe("video-1-caption-audio");
		expect(second.file).toBe(extractedFile);
		expect(second.wasReused).toBe(true);
		expect(extractionCount).toBe(1);
		expect(metadataUpdates).toHaveLength(1);
	});
});
