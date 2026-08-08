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

export async function resolveCaptionUploadFile({
	projectId,
	mediaAsset,
	loadMediaAsset,
}: {
	projectId: string;
	mediaAsset: MediaAsset;
	loadMediaAsset: (args: {
		projectId: string;
		id: string;
	}) => Promise<MediaAsset | null>;
}): Promise<File> {
	const persistedMediaAsset =
		(await loadMediaAsset({ projectId, id: mediaAsset.id })) ?? mediaAsset;
	const file = normalizeCaptionUploadFile({
		file: persistedMediaAsset.file,
		originalFilename: persistedMediaAsset.name || mediaAsset.name,
		originalMimeType:
			persistedMediaAsset.mimeType ||
			persistedMediaAsset.file?.type ||
			mediaAsset.mimeType ||
			mediaAsset.file?.type,
	});
	if (!(file instanceof File)) {
		throw new CaptionMediaError(
			"The selected video file is not available in browser storage. Re-import the video and try again.",
		);
	}
	if (file.size <= 0) {
		throw new CaptionMediaError(
			"The selected video file is empty in browser storage. Re-import the video and try again.",
		);
	}
	return file;
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
	const file = await resolveCaptionUploadFile({
		projectId,
		mediaAsset,
		loadMediaAsset,
	});

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
			name: file.name,
			mimeType: file.type,
			serverAssetId: uploaded.assetId,
			serverDownloadUrl: uploaded.downloadUrl,
			syncStatus: "synced",
			syncError: undefined,
		},
		serverAssetId: uploaded.assetId,
		uploaded: true,
	};
}

function normalizeCaptionUploadFile({
	file,
	originalFilename,
	originalMimeType,
}: {
	file: File | Blob | undefined;
	originalFilename: string | undefined;
	originalMimeType: string | undefined;
}): File {
	if (!(file instanceof Blob)) {
		throw new CaptionMediaError(
			"The selected video file is not available in browser storage. Re-import the video and try again.",
		);
	}

	const type = originalMimeType || file.type || "video/mp4";
	const name = normalizeUploadFilename({
		filename: originalFilename || (file instanceof File ? file.name : ""),
		type,
	});
	return new File([file], name, {
		type,
		lastModified: file instanceof File ? file.lastModified : Date.now(),
	});
}

function normalizeUploadFilename({
	filename,
	type,
}: {
	filename: string;
	type: string;
}): string {
	const trimmed = filename.trim();
	if (/\.[A-Za-z0-9]{1,8}$/.test(trimmed)) return trimmed;
	const extension =
		type === "video/webm"
			? "webm"
			: type === "video/quicktime"
				? "mov"
				: type === "video/x-m4v"
					? "m4v"
					: "mp4";
	return `${trimmed || "caption-video"}.${extension}`;
}
