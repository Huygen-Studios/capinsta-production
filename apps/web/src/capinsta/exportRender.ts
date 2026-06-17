import type { TextElement } from "@/timeline";
import type {
	CapinstaCaptionDocumentRecord,
	NeutralCaptionClip,
	NeutralCaptionWord,
} from "./types";
import type { CapinstaCaptionStyleV1 } from "./styles/styleTypes";
import { getActiveCaptionAtTime } from "./adapter";
import { resolveCapinstaClipStyle } from "./styles/styleMigration";
import { styleToExport, type CapinstaExportStyle } from "./styles/styleToExport";

export interface CapinstaExportWord {
	id: string;
	text: string;
	start: number;
	end: number;
}

export interface CapinstaTextRenderData {
	documentId: string;
	clipId: string;
	clipText: string;
	renderText: string;
	wordIds: string[];
	words: CapinstaExportWord[];
	timingNeedsReview: boolean;
	activeWordColor: string;
	style: CapinstaExportStyle;
	captionStyle: CapinstaCaptionStyleV1;
}

export interface CapinstaExportCaptionManifestEntry {
	documentId: string;
	clipId: string;
	start: number;
	end: number;
	text: string;
	wordIds: string[];
	timingNeedsReview: boolean;
}

function wrapExportText({
	text,
	style,
}: {
	text: string;
	style: CapinstaExportStyle;
}): string {
	const normalized = text.trim().replace(/\s+/g, " ");
	if (!normalized) return "";

	const maxLines = style.maxLines === "auto" ? 2 : style.maxLines;
	const averageGlyphWidth = Math.max(4, style.canvasFontSizePx * 0.58);
	const maxCharsPerLine = Math.max(
		1,
		Math.floor(style.maxWidthPx / averageGlyphWidth),
	);
	const words = normalized.split(/\s+/);
	const lines: string[] = [];
	let currentLine = "";

	for (const word of words) {
		const nextLine = currentLine ? `${currentLine} ${word}` : word;
		if (nextLine.length <= maxCharsPerLine || !currentLine) {
			currentLine = nextLine;
			continue;
		}
		lines.push(currentLine);
		currentLine = word;
	}
	if (currentLine) lines.push(currentLine);

	return lines.slice(0, maxLines).join("\n");
}

function findRecordForElement({
	records,
	element,
}: {
	records: CapinstaCaptionDocumentRecord[];
	element: TextElement;
}): {
	record: CapinstaCaptionDocumentRecord;
	clip: NeutralCaptionClip;
} | null {
	if (!element.capinstaDocumentId || !element.capinstaClipId) return null;

	for (const record of records) {
		if (record.document.id !== element.capinstaDocumentId) continue;
		const clip = record.document.clips.find(
			(candidate) => candidate.id === element.capinstaClipId,
		);
		if (clip) return { record, clip };
	}

	return null;
}

function toExportWord(word: NeutralCaptionWord): CapinstaExportWord {
	return {
		id: word.id,
		text: word.displayedText || word.text,
		start: word.start,
		end: word.end,
	};
}

function buildRenderDataForClip({
	record,
	clip,
	canvasSize,
}: {
	record: CapinstaCaptionDocumentRecord;
	clip: NeutralCaptionClip;
	canvasSize?: { width: number; height: number };
}): CapinstaTextRenderData {
	const style = styleToExport({
		style: resolveCapinstaClipStyle({ document: record.document, clip }),
		timingNeedsReview: clip.timingNeedsReview,
		canvasSize,
	});
	const captionStyle = resolveCapinstaClipStyle({
		document: record.document,
		clip,
	});
	const wordsById = new Map(record.document.words.map((word) => [word.id, word]));
	const words = clip.wordIds
		.map((wordId) => wordsById.get(wordId))
		.filter((word): word is NeutralCaptionWord => word !== undefined)
		.map(toExportWord);

	return {
		documentId: record.document.id,
		clipId: clip.id,
		clipText: clip.text,
		renderText: wrapExportText({ text: clip.text, style }),
		wordIds: [...clip.wordIds],
		words,
		timingNeedsReview:
			Boolean(clip.timingNeedsReview) || words.length !== clip.wordIds.length,
		activeWordColor: style.activeWordColor,
		style,
		captionStyle,
	};
}

export function getCapinstaTextRenderDataForElement({
	records,
	element,
	canvasSize,
}: {
	records: CapinstaCaptionDocumentRecord[];
	element: TextElement;
	canvasSize?: { width: number; height: number };
}): CapinstaTextRenderData | null {
	const binding = findRecordForElement({ records, element });
	if (!binding) return null;

	const { record, clip } = binding;
	return buildRenderDataForClip({ record, clip, canvasSize });
}

export function isCapinstaExportCarrierTextElement({
	element,
	capinstaElementIds,
	trackId,
	capinstaTrackIds,
}: {
	element: TextElement;
	capinstaElementIds?: Set<string>;
	trackId?: string;
	capinstaTrackIds?: Set<string>;
}): boolean {
	return Boolean(
		element.capinstaDocumentId ||
			capinstaElementIds?.has(element.id) ||
			(trackId && capinstaTrackIds?.has(trackId)),
	);
}

export function getActiveCapinstaTextRenderDataAtTime({
	records,
	timeSeconds,
	canvasSize,
}: {
	records: CapinstaCaptionDocumentRecord[];
	timeSeconds: number;
	canvasSize?: { width: number; height: number };
}): CapinstaTextRenderData | null {
	if (!Number.isFinite(timeSeconds)) return null;

	for (const record of records) {
		const clip = getActiveCaptionAtTime(record.document, timeSeconds);
		if (!clip) continue;
		return buildRenderDataForClip({ record, clip, canvasSize });
	}

	return null;
}

export function getActiveCapinstaExportWordIdsAtTime({
	renderData,
	timeSeconds,
}: {
	renderData: CapinstaTextRenderData | null;
	timeSeconds: number;
}): string[] {
	if (
		!renderData ||
		!renderData.style.useActiveWordHighlight
	) {
		return [];
	}
	return renderData.words
		.filter((word) => word.start <= timeSeconds && timeSeconds < word.end)
		.map((word) => word.id);
}

export function createCapinstaExportCaptionManifest({
	records,
}: {
	records: CapinstaCaptionDocumentRecord[];
}): CapinstaExportCaptionManifestEntry[] {
	const seen = new Set<string>();
	const entries: CapinstaExportCaptionManifestEntry[] = [];

	for (const record of records) {
		for (const clip of record.document.clips) {
			const key = `${record.document.id}:${clip.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			entries.push({
				documentId: record.document.id,
				clipId: clip.id,
				start: clip.start,
				end: clip.end,
				text: clip.text,
				wordIds: [...clip.wordIds],
				timingNeedsReview: Boolean(clip.timingNeedsReview),
			});
		}
	}

	return entries.sort(
		(left, right) => left.start - right.start || left.clipId.localeCompare(right.clipId),
	);
}
