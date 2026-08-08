import { getCapinstaPresetStyle } from "./styles/presetRegistry";
import type {
	NeutralCaptionClip,
	NeutralCaptionDocument,
	NeutralCaptionWord,
} from "./types";
import type { SubtitleCue } from "@/subtitles/types";
import { generateUUID } from "@/utils/id";

const IMPORTED_CAPTION_PRESET_ID = "word_highlight_box";
const TOKEN_PATTERN = /\S+/gu;

function tokenWeight(token: string): number {
	return Math.max(1, Array.from(token).length);
}

function estimatedWordsForCue({
	cue,
	cueIndex,
	documentId,
}: {
	cue: SubtitleCue;
	cueIndex: number;
	documentId: string;
}): NeutralCaptionWord[] {
	const tokens = Array.from(
		cue.text.matchAll(TOKEN_PATTERN),
		(match) => match[0],
	);
	if (tokens.length === 0) return [];

	const cueEnd = cue.startTime + cue.duration;
	const weights = tokens.map(tokenWeight);
	let cursor = cue.startTime;

	return tokens.map((token, tokenIndex) => {
		const remainingDuration = Math.max(0, cueEnd - cursor);
		const remainingWeight = weights
			.slice(tokenIndex)
			.reduce((total, weight) => total + weight, 0);
		const end =
			tokenIndex === tokens.length - 1
				? cueEnd
				: Math.min(
						cueEnd,
						cursor +
							remainingDuration *
								(weights[tokenIndex]! / Math.max(1, remainingWeight)),
					);
		const id = `${documentId}-cue-${cueIndex + 1}-word-${tokenIndex + 1}`;
		const word: NeutralCaptionWord = {
			id,
			text: token,
			displayedText: token,
			start: cursor,
			end,
			timingSource: "estimated",
			timingSourceDetail: "deterministic_srt_cue_estimate",
			timingWarning:
				"Word timing was estimated from the SRT cue and is not speech-aligned.",
			timingNeedsReview: true,
			disableActiveWordHighlighting: true,
			sourceWordId: id,
		};
		cursor = end;
		return word;
	});
}

export function importedSubtitleCuesToCaptionDocument({
	captions,
	sourceName,
	documentId = `capinsta-doc-import-${generateUUID()}`,
	importedAt = new Date().toISOString(),
}: {
	captions: SubtitleCue[];
	sourceName: string;
	documentId?: string;
	importedAt?: string;
}): NeutralCaptionDocument {
	if (captions.length === 0) {
		throw new Error("Cannot create a caption document without cues.");
	}

	const trackId = `capinsta-caption-track-${documentId}`;
	const style = getCapinstaPresetStyle(IMPORTED_CAPTION_PRESET_ID);
	const words: NeutralCaptionWord[] = [];
	const clips: NeutralCaptionClip[] = captions.map((cue, cueIndex) => {
		const cueWords = estimatedWordsForCue({ cue, cueIndex, documentId });
		words.push(...cueWords);
		const id = `${documentId}-cue-${cueIndex + 1}`;
		return {
			id,
			trackId,
			start: cue.startTime,
			end: cue.startTime + cue.duration,
			text: cue.text,
			wordIds: cueWords.map((word) => word.id),
			stylePresetId: IMPORTED_CAPTION_PRESET_ID,
			style: structuredClone(style),
			selected: false,
			editable: true,
			manuallyEdited: false,
			timingNeedsReview: true,
			timingSource: "estimated",
			disableActiveWordHighlighting: true,
			sourceClipId: id,
		};
	});
	const durationSeconds = Math.max(...clips.map((clip) => clip.end));

	return {
		id: documentId,
		trackId,
		sourceTranscriptRef: {
			version: "capinsta.transcript.v1",
			sourceAssetId: documentId,
			sourceAssetName: sourceName,
			provider: "subtitle_import",
		},
		durationSeconds,
		languageMode: "auto",
		outputLanguage: "original",
		transformation: "none",
		stylePresetId: IMPORTED_CAPTION_PRESET_ID,
		style: structuredClone(style),
		clips,
		words,
		manualEdits: {},
		timing: {
			sourceOfTruth: "clips",
			generatedAt: importedAt,
			audioDurationSeconds: durationSeconds,
			report: {
				importedSubtitle: true,
				wordTimingSource: "deterministic_srt_cue_estimate",
				activeWordHighlighting: false,
			},
		},
	};
}
