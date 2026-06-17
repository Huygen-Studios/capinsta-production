import type {
	CapinstaCaptionTimingIndex,
	CapinstaCaptionTimingIndexRecord,
} from "../captionTimingIndex";
import {
	getActiveCapinstaCaptionStateFromIndex,
} from "../captionTimingIndex";
import type { CapinstaTextRenderData } from "../exportRender";
import {
	normalizeCaptionStyleConfig,
} from "../original/captionStyleConfig";
import {
	resolveSafeCaptionLayout,
	type CaptionCanvasSize,
} from "../original/captionLayoutSafety";
import type {
	AlignedWord,
	Caption,
	CaptionStyleConfig,
} from "../original/types";
import {
	toOriginalCaption,
	toOriginalCaptionStyleConfig,
} from "../originalAdapter";
import { resolveCapinstaClipStyle } from "../styles/styleMigration";
import type { CapinstaCaptionStyleV1 } from "../styles/styleTypes";
import type {
	CapinstaCaptionDocumentRecord,
	NeutralCaptionClip,
	NeutralCaptionDocument,
	NeutralCaptionWord,
} from "../types";

export type CapinstaRendererPath =
	| "rendered_capinsta_preview"
	| "rendered_capinsta_wysiwyg";

export interface CapinstaRenderManifest {
	activeCaptionId: string;
	activeClipId: string;
	text: string;
	presetId: string;
	activeWordId: string | null;
	activeWordColor: string;
	rendererPath: CapinstaRendererPath;
	skippedOpenCutTextIds: string[];
	skippedCapinstaTrackIds: string[];
	finalFontSize: number | null;
	finalPosition: { xPercent: number; yPercent: number } | null;
	finalBackgroundBox: {
		widthPercent: number;
		heightPercent: number | null;
	} | null;
}

export interface CapinstaRenderModel {
	rendererPath: CapinstaRendererPath;
	record?: CapinstaCaptionDocumentRecord;
	document: NeutralCaptionDocument;
	clip: NeutralCaptionClip;
	text: string;
	originalCaption: Caption;
	words: AlignedWord[];
	activeWordIds: string[];
	activeWordId: string | null;
	presetId: string;
	captionStyle: CapinstaCaptionStyleV1;
	styleConfig: CaptionStyleConfig;
	normalizedStyleConfig: CaptionStyleConfig;
	activeWordColor: string;
	layout: ReturnType<typeof resolveSafeCaptionLayout> | null;
	viewport: CaptionCanvasSize | null;
	manifest: CapinstaRenderManifest;
}

function toAlignedWord(word: NeutralCaptionWord): AlignedWord {
	return {
		word: word.text,
		displayedWord: word.displayedText || word.text,
		start: word.start,
		end: word.end,
		score: 1,
	};
}

function wordsForClip({
	document,
	clip,
}: {
	document: NeutralCaptionDocument;
	clip: NeutralCaptionClip;
}): AlignedWord[] {
	const wordsById = new Map(document.words.map((word) => [word.id, word]));
	return clip.wordIds
		.map((wordId) => wordsById.get(wordId))
		.filter((word): word is NeutralCaptionWord => word !== undefined)
		.map(toAlignedWord);
}

function buildModel({
	record,
	document,
	clip,
	activeWordIds,
	rendererPath,
	viewport,
	skippedOpenCutTextIds = [],
	skippedCapinstaTrackIds = [],
}: {
	record?: CapinstaCaptionDocumentRecord;
	document: NeutralCaptionDocument;
	clip: NeutralCaptionClip;
	activeWordIds: string[];
	rendererPath: CapinstaRendererPath;
	viewport?: CaptionCanvasSize;
	skippedOpenCutTextIds?: string[];
	skippedCapinstaTrackIds?: string[];
}): CapinstaRenderModel {
	const captionStyle = resolveCapinstaClipStyle({ document, clip });
	const styleConfig = toOriginalCaptionStyleConfig({ style: captionStyle });
	const normalizedStyleConfig = normalizeCaptionStyleConfig(styleConfig);
	const originalCaption = toOriginalCaption({ document, clip, style: captionStyle });
	const originalWords = originalCaption.words ?? [];
	const words = originalWords.length
		? originalWords
		: wordsForClip({ document, clip });
	const layout = viewport
		? resolveSafeCaptionLayout(normalizedStyleConfig, {
				canvas: viewport,
				previewScale: 1,
				words,
				text: clip.text,
			})
		: null;
	const activeWordId = activeWordIds[0] ?? null;
	const manifest: CapinstaRenderManifest = {
		activeCaptionId: clip.id,
		activeClipId: clip.id,
		text: clip.text,
		presetId: captionStyle.presetId,
		activeWordId,
		activeWordColor: normalizedStyleConfig.activeWordColor,
		rendererPath,
		skippedOpenCutTextIds,
		skippedCapinstaTrackIds,
		finalFontSize: layout?.fontSize ?? null,
		finalPosition: layout
			? { xPercent: layout.xPercent, yPercent: layout.yPercent }
			: null,
		finalBackgroundBox: layout
			? {
					widthPercent: layout.widthPercent,
					heightPercent: layout.maxHeightPercent ?? null,
				}
			: null,
	};

	return {
		rendererPath,
		record,
		document,
		clip,
		text: clip.text,
		originalCaption,
		words,
		activeWordIds,
		activeWordId,
		presetId: captionStyle.presetId,
		captionStyle,
		styleConfig,
		normalizedStyleConfig,
		activeWordColor: normalizedStyleConfig.activeWordColor,
		layout,
		viewport: viewport ?? null,
		manifest,
	};
}

export function createCapinstaRenderModelFromIndex({
	index,
	timeSeconds,
	rendererPath,
	viewport,
	skippedOpenCutTextIds,
	skippedCapinstaTrackIds,
}: {
	index: CapinstaCaptionTimingIndex;
	timeSeconds: number;
	rendererPath: CapinstaRendererPath;
	viewport?: CaptionCanvasSize;
	skippedOpenCutTextIds?: string[];
	skippedCapinstaTrackIds?: string[];
}): CapinstaRenderModel | null {
	const activeState = getActiveCapinstaCaptionStateFromIndex({
		index,
		timeSeconds,
	});
	if (!activeState) return null;

	return buildModel({
		record: activeState.record,
		document: activeState.document,
		clip: activeState.clip,
		activeWordIds: activeState.activeWordIds,
		rendererPath,
		viewport,
		skippedOpenCutTextIds,
		skippedCapinstaTrackIds,
	});
}

export function createCapinstaRenderModelFromIndexedRecord({
	indexedRecord,
	clip,
	timeSeconds,
	rendererPath,
	viewport,
	skippedOpenCutTextIds,
	skippedCapinstaTrackIds,
}: {
	indexedRecord: CapinstaCaptionTimingIndexRecord;
	clip: NeutralCaptionClip;
	timeSeconds: number;
	rendererPath: CapinstaRendererPath;
	viewport?: CaptionCanvasSize;
	skippedOpenCutTextIds?: string[];
	skippedCapinstaTrackIds?: string[];
}): CapinstaRenderModel {
	const activeWordIds = clip.wordIds.filter((wordId) => {
		const word = indexedRecord.wordsById.get(wordId);
		return Boolean(word && word.start <= timeSeconds && timeSeconds < word.end);
	});
	return buildModel({
		record: indexedRecord.record,
		document: indexedRecord.record.document,
		clip,
		activeWordIds,
		rendererPath,
		viewport,
		skippedOpenCutTextIds,
		skippedCapinstaTrackIds,
	});
}

export function createCapinstaRenderModelFromExportData({
	renderData,
	activeWordIds,
	rendererPath,
	viewport,
	skippedOpenCutTextIds,
	skippedCapinstaTrackIds,
}: {
	renderData: CapinstaTextRenderData;
	activeWordIds: string[];
	rendererPath: CapinstaRendererPath;
	viewport?: CaptionCanvasSize;
	skippedOpenCutTextIds?: string[];
	skippedCapinstaTrackIds?: string[];
}): CapinstaRenderModel {
	const firstWordStart =
		renderData.words.length > 0
			? Math.min(...renderData.words.map((word) => word.start))
			: 0;
	const lastWordEnd =
		renderData.words.length > 0
			? Math.max(...renderData.words.map((word) => word.end))
			: 0;
	const document: NeutralCaptionDocument = {
		id: renderData.documentId,
		trackId: "capinsta-export",
		sourceTranscriptRef: {
			version: "capinsta.transcript.v1",
			sourceAssetId: "capinsta-export",
			sourceAssetName: "Capinsta export",
			provider: "capinsta",
		},
		durationSeconds: lastWordEnd,
		languageMode: "auto_mixed_indian",
		stylePresetId: renderData.captionStyle.presetId,
		style: renderData.captionStyle,
		clips: [
			{
				id: renderData.clipId,
				trackId: "capinsta-export",
				text: renderData.clipText,
				start: firstWordStart,
				end: lastWordEnd,
				wordIds: [...renderData.wordIds],
				stylePresetId: renderData.captionStyle.presetId,
				selected: false,
				editable: true,
				manuallyEdited: false,
				style: renderData.captionStyle,
				timingNeedsReview: renderData.timingNeedsReview,
				timingSource: "manual",
				sourceClipId: renderData.clipId,
			},
		],
		words: renderData.words.map((word) => ({
			id: word.id,
			text: word.text,
			displayedText: word.text,
			start: word.start,
			end: word.end,
			timingSource: "manual",
			sourceWordId: word.id,
		})),
		manualEdits: {},
		timing: {
			sourceOfTruth: "words",
			generatedAt: "1970-01-01T00:00:00.000Z",
			audioDurationSeconds: lastWordEnd,
		},
	};

	return buildModel({
		document,
		clip: document.clips[0]!,
		activeWordIds,
		rendererPath,
		viewport,
		skippedOpenCutTextIds,
		skippedCapinstaTrackIds,
	});
}
