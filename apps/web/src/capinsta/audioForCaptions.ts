import type { MediaAsset } from "@/media/types";
import { extractSpeechAudioFile } from "@/media/mediabunny";

export interface AudioAssetForCaptions {
	assetId: string;
	sourceAssetId: string;
	file: File;
	name: string;
	duration?: number;
	wasReused: boolean;
	audioOrigin: "rendered_timeline" | "rendered_selection" | "source_media";
	timelineOffsetUs: number;
	timelineDurationUs?: number;
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
	/** Final mixed timeline/range render. Sample zero maps to timelineOffsetUs. */
	renderedTimelineAudio?: {
		file: File;
		name: string;
		duration?: number;
		timelineOffsetUs: number;
		timelineDurationUs: number;
		selection?: boolean;
	};
	extractAudioFile?: typeof extractSpeechAudioFile;
}

const inSessionAudioByVideoAssetId = new Map<string, AudioAssetForCaptions>();

export function clearCaptionAudioSessionCacheForTests(): void {
	inSessionAudioByVideoAssetId.clear();
}

export async function ensureAudioForCaptions({
	videoAssetId,
	getAssets,
	cacheAudioMetadata,
	renderedTimelineAudio,
	extractAudioFile = extractSpeechAudioFile,
}: EnsureAudioForCaptionsInput): Promise<AudioAssetForCaptions> {
	if (renderedTimelineAudio) {
		return {
			assetId: `${videoAssetId}-timeline-render`,
			sourceAssetId: videoAssetId,
			file: renderedTimelineAudio.file,
			name: renderedTimelineAudio.name,
			duration: renderedTimelineAudio.duration,
			wasReused: false,
			audioOrigin: renderedTimelineAudio.selection
				? "rendered_selection"
				: "rendered_timeline",
			timelineOffsetUs: renderedTimelineAudio.timelineOffsetUs,
			timelineDurationUs: renderedTimelineAudio.timelineDurationUs,
		};
	}
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
		const audioAsset: AudioAssetForCaptions = {
			assetId: extractedAudioAsset.id,
			sourceAssetId: videoAsset.id,
			file: extractedAudioAsset.file,
			name: extractedAudioAsset.name,
			duration: extractedAudioAsset.duration,
			wasReused: true,
			audioOrigin: "source_media",
			timelineOffsetUs: 0,
			timelineDurationUs: extractedAudioAsset.duration
				? Math.round(extractedAudioAsset.duration * 1_000_000)
				: undefined,
		};
		inSessionAudioByVideoAssetId.set(videoAssetId, audioAsset);
		return audioAsset;
	}

	const speechAudioFile = await extractAudioFile({
		file: videoAsset.file,
		sourceName: videoAsset.name,
	});
	const sourceAudio: AudioAssetForCaptions = {
		assetId: `${videoAsset.id}-caption-audio`,
		sourceAssetId: videoAsset.id,
		file: speechAudioFile,
		name: speechAudioFile.name,
		duration: videoAsset.duration,
		wasReused: false,
		audioOrigin: "source_media",
		timelineOffsetUs: 0,
		timelineDurationUs: videoAsset.duration
			? Math.round(videoAsset.duration * 1_000_000)
			: undefined,
	};
	inSessionAudioByVideoAssetId.set(videoAssetId, sourceAudio);
	cacheAudioMetadata?.({
		videoAssetId: videoAsset.id,
		extractedAudioAssetId: sourceAudio.assetId,
		audioExtractionStatus: "ready",
		duration: videoAsset.duration,
	});
	return sourceAudio;
}
