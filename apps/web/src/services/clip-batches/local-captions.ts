import {
	checkCapinstaHealth,
	normalizeCapinstaJobToTranscript,
	startCapinstaCaptionJob,
} from "@/capinsta/apiClient";
import { getCapinstaApiBaseUrl } from "@/capinsta/featureFlags";
import { pollCapinstaJobUntilDone } from "@/capinsta/jobPolling";
import { capinstaTranscriptToOpenCutSubtitleImport } from "@/capinsta/opencutClassicAdapter";
import { getCapinstaCaptionTrackIds } from "@/capinsta/captionTimelineSync";
import type { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import { extractSpeechAudioFile } from "@/media/mediabunny";
import type { LocalClipItemV1 } from "@/project/types";
import { insertCaptionDocumentAsTextTrack } from "@/subtitles/insert";

export type LocalCaptionProgress =
	| "preparing"
	| "uploading"
	| "transcribing"
	| "creating"
	| "completed";

export async function generateLocalClipCaptions({
	editor,
	source,
	item,
	signal,
	onProgress,
}: {
	editor: EditorCore;
	source: MediaAsset;
	item: LocalClipItemV1;
	signal?: AbortSignal;
	onProgress?: (progress: LocalCaptionProgress) => void;
}): Promise<void> {
	const durationSeconds = (item.sourceEndMs - item.sourceStartMs) / 1000;
	if (durationSeconds <= 0 || durationSeconds > 180)
		throw new Error("The selected clip must be shorter than three minutes.");
	onProgress?.("preparing");
	const segment = await extractSpeechAudioFile({
		file: source.file,
		sourceName: `${item.title}.mp4`,
		sourceStartSeconds: item.sourceStartMs / 1000,
		sourceEndSeconds: item.sourceEndMs / 1000,
	});
	if (signal?.aborted)
		throw new DOMException("Caption generation cancelled.", "AbortError");
	const baseUrl = getCapinstaApiBaseUrl();
	await checkCapinstaHealth({
		baseUrl,
		signal,
		requiredCapabilities: ["captions", "jobs"],
	});
	onProgress?.("uploading");
	const started = await startCapinstaCaptionJob({
		baseUrl,
		file: segment,
		projectId: editor.project.getActive().metadata.id,
		languageMode: "auto",
		captionOutput: "original",
		timelineOffsetUs: 0,
		timelineDurationUs: Math.round(durationSeconds * 1_000_000),
		audioOrigin: "source_media",
		signal,
	});
	onProgress?.("transcribing");
	const completed = await pollCapinstaJobUntilDone({
		baseUrl,
		jobId: started.job_id,
		signal,
	});
	const transcript = normalizeCapinstaJobToTranscript({
		job: completed,
		sourceAsset: {
			assetId: source.id,
			assetName: source.name,
			durationSeconds,
			mimeType: segment.type,
		},
	});
	onProgress?.("creating");
	const result = capinstaTranscriptToOpenCutSubtitleImport(transcript);
	if (
		!insertCaptionDocumentAsTextTrack({
			editor,
			captions: result.captions,
			document: result.document,
		})
	) {
		throw new Error(`Captions could not be generated for ${item.title}.`);
	}
	onProgress?.("completed");
}

export function removeGeneratedCaptions(editor: EditorCore): void {
	const project = editor.project.getActive();
	const trackIds = getCapinstaCaptionTrackIds({
		records: project.capinstaCaptionDocuments ?? [],
	});
	for (const trackId of trackIds) editor.timeline.removeTrack({ trackId });
	editor.project.replaceCapinstaCaptionDocuments({ records: [] });
}
