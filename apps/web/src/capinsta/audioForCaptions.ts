import type { MediaAsset } from "@/media/types";

export interface AudioAssetForCaptions {
	assetId: string;
	sourceAssetId: string;
	file: File;
	name: string;
	duration?: number;
	wasReused: boolean;
}

interface EnsureAudioForCaptionsInput {
	videoAssetId: string;
	getAssets: () => MediaAsset[];
	cacheAudioMetadata?: (metadata: {
		videoAssetId: string;
		extractedAudioAssetId: string;
		audioExtractionStatus: "ready";
		duration?: number;
	}) => void;
}

const inSessionAudioByVideoAssetId = new Map<string, AudioAssetForCaptions>();

export function clearCaptionAudioSessionCacheForTests(): void {
	inSessionAudioByVideoAssetId.clear();
}

export async function ensureAudioForCaptions({
	videoAssetId,
	getAssets,
	cacheAudioMetadata,
}: EnsureAudioForCaptionsInput): Promise<AudioAssetForCaptions> {
	const cached = inSessionAudioByVideoAssetId.get(videoAssetId);
	if (cached) {
		return { ...cached, wasReused: true };
	}

	const assets = getAssets();
	const videoAsset = assets.find((asset) => asset.id === videoAssetId);
	if (!videoAsset) {
		throw new Error("Selected media is no longer available.");
	}
	if (videoAsset.type !== "video") {
		throw new Error("Select a video file to generate captions.");
	}

	const extractedAudioAsset = videoAsset.extractedAudioAssetId
		? assets.find((asset) => asset.id === videoAsset.extractedAudioAssetId)
		: null;
	if (extractedAudioAsset?.type === "audio") {
		const audioAsset = {
			assetId: extractedAudioAsset.id,
			sourceAssetId: videoAsset.id,
			file: extractedAudioAsset.file,
			name: extractedAudioAsset.name,
			duration: extractedAudioAsset.duration,
			wasReused: true,
		};
		inSessionAudioByVideoAssetId.set(videoAssetId, audioAsset);
		return audioAsset;
	}

	// The current Capinsta backend accepts video uploads and performs audio
	// extraction server-side. Cache the source video as the caption audio source
	// so the browser never repeats expensive in-tab extraction work.
	const sourceAudio = {
		assetId: videoAsset.id,
		sourceAssetId: videoAsset.id,
		file: videoAsset.file,
		name: videoAsset.name,
		duration: videoAsset.duration,
		wasReused: false,
	};
	inSessionAudioByVideoAssetId.set(videoAssetId, sourceAudio);
	cacheAudioMetadata?.({
		videoAssetId: videoAsset.id,
		extractedAudioAssetId: videoAsset.id,
		audioExtractionStatus: "ready",
		duration: videoAsset.duration,
	});
	return sourceAudio;
}
