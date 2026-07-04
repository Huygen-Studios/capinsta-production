import type { MediaAsset } from "@/media/types";
import { uploadProjectMediaAsset } from "./mediaAssetApi";

type UploadProjectMediaAsset = typeof uploadProjectMediaAsset;

export class CaptionMediaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CaptionMediaError";
	}
}

export interface EnsureServerMediaAssetForCaptionsResult {
	mediaAsset: MediaAsset;
	serverAssetId: string;
	uploaded: boolean;
}

export async function ensureServerMediaAssetForCaptions({
	projectId,
	mediaAsset,
	loadMediaAsset,
	uploadMediaAsset = uploadProjectMediaAsset,
	signal,
}: {
	projectId: string;
	mediaAsset: MediaAsset;
	loadMediaAsset: (args: {
		projectId: string;
		id: string;
	}) => Promise<MediaAsset | null>;
	uploadMediaAsset?: UploadProjectMediaAsset;
	signal?: AbortSignal;
}): Promise<EnsureServerMediaAssetForCaptionsResult> {
	if (mediaAsset.serverAssetId) {
		return {
			mediaAsset,
			serverAssetId: mediaAsset.serverAssetId,
			uploaded: false,
		};
	}

	const persistedMediaAsset =
		(await loadMediaAsset({ projectId, id: mediaAsset.id })) ?? mediaAsset;
	const file = persistedMediaAsset.file;
	if (!(file instanceof File)) {
		throw new CaptionMediaError(
			"The selected video file is not available in browser storage. Re-import the video and try again.",
		);
	}

	const uploaded = await uploadMediaAsset({
		projectId,
		file,
		signal,
	});
	if (!uploaded.assetId) {
		throw new CaptionMediaError(
			"The media service did not return a valid media asset ID. Please retry caption generation.",
		);
	}

	return {
		mediaAsset: {
			...mediaAsset,
			file,
			serverAssetId: uploaded.assetId,
			serverDownloadUrl: uploaded.downloadUrl,
			syncStatus: "synced",
			syncError: undefined,
		},
		serverAssetId: uploaded.assetId,
		uploaded: true,
	};
}
