import { describe, expect, test } from "bun:test";
import type { MediaAsset } from "@/media/types";
import {
	CaptionMediaError,
	ensureServerMediaAssetForCaptions,
} from "./captionMediaAsset";

function makeVideoAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
	const file = new File(["video"], "local-video.webm", { type: "video/webm" });
	return {
		id: "local-asset-1",
		name: file.name,
		type: "video",
		mimeType: file.type,
		file,
		url: "blob:local-video",
		duration: 3,
		syncStatus: "local",
		...overrides,
	};
}

describe("ensureServerMediaAssetForCaptions", () => {
	test("reuses an existing server media asset id", async () => {
		const mediaAsset = makeVideoAsset({ serverAssetId: "server-asset-1" });

		const result = await ensureServerMediaAssetForCaptions({
			projectId: "project-1",
			mediaAsset,
			loadMediaAsset: async () => {
				throw new Error("should not load local file");
			},
			uploadMediaAsset: async () => {
				throw new Error("should not upload");
			},
		});

		expect(result.serverAssetId).toBe("server-asset-1");
		expect(result.uploaded).toBe(false);
	});

	test("uploads the locally persisted file and returns a valid server id", async () => {
		const memoryAsset = makeVideoAsset();
		const persistedFile = new File(["persisted"], "persisted.webm", {
			type: "video/webm",
		});
		const persistedAsset = makeVideoAsset({
			file: persistedFile,
			name: persistedFile.name,
			mimeType: persistedFile.type,
		});

		const result = await ensureServerMediaAssetForCaptions({
			projectId: "project-1",
			mediaAsset: memoryAsset,
			loadMediaAsset: async ({ projectId, id }) => {
				expect(projectId).toBe("project-1");
				expect(id).toBe("local-asset-1");
				return persistedAsset;
			},
			uploadMediaAsset: async ({ projectId, file }) => {
				expect(projectId).toBe("project-1");
				expect(file).toBe(persistedFile);
				return {
					assetId: "server-asset-2",
					downloadUrl: "/api/media/assets/server-asset-2/content",
					sizeBytes: file.size,
				};
			},
		});

		expect(result.uploaded).toBe(true);
		expect(result.serverAssetId).toBe("server-asset-2");
		expect(result.mediaAsset.file).toBe(persistedFile);
		expect(result.mediaAsset.syncStatus).toBe("synced");
	});

	test("fails before caption job creation when the local file is unavailable", async () => {
		const mediaAsset = makeVideoAsset();
		Object.defineProperty(mediaAsset, "file", {
			configurable: true,
			value: undefined,
		});

		await expect(
			ensureServerMediaAssetForCaptions({
				projectId: "project-1",
				mediaAsset,
				loadMediaAsset: async () => null,
				uploadMediaAsset: async () => {
					throw new Error("should not upload");
				},
			}),
		).rejects.toThrow(CaptionMediaError);
	});

	test("fails before caption job creation when upload returns no media asset id", async () => {
		await expect(
			ensureServerMediaAssetForCaptions({
				projectId: "project-1",
				mediaAsset: makeVideoAsset(),
				loadMediaAsset: async ({ id }) => makeVideoAsset({ id }),
				uploadMediaAsset: async ({ file }) => ({
					assetId: "",
					downloadUrl: "",
					sizeBytes: file.size,
				}),
			}),
		).rejects.toThrow("valid media asset ID");
	});
});
