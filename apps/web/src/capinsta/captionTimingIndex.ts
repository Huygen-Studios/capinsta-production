import type {
	CapinstaCaptionDocumentRecord,
	NeutralCaptionClip,
	NeutralCaptionDocument,
	NeutralCaptionWord,
} from "./types";
import type { ActiveCapinstaCaptionState } from "./captionTimelineSync";

export interface CapinstaCaptionTimingIndexRecord {
	record: CapinstaCaptionDocumentRecord;
	clips: NeutralCaptionClip[];
	wordsById: Map<string, NeutralCaptionWord>;
}

export interface CapinstaCaptionTimingIndex {
	records: CapinstaCaptionTimingIndexRecord[];
	clipCount: number;
	wordCount: number;
}

function sortedClips(document: NeutralCaptionDocument): NeutralCaptionClip[] {
	return [...document.clips].sort(
		(left, right) => left.start - right.start || left.id.localeCompare(right.id),
	);
}

export function createCapinstaCaptionTimingIndex({
	records,
}: {
	records: CapinstaCaptionDocumentRecord[];
}): CapinstaCaptionTimingIndex {
	let clipCount = 0;
	let wordCount = 0;
	const indexedRecords = records.map((record) => {
		const clips = sortedClips(record.document);
		const wordsById = new Map(record.document.words.map((word) => [word.id, word]));
		clipCount += clips.length;
		wordCount += record.document.words.length;
		return { record, clips, wordsById };
	});

	return {
		records: indexedRecords,
		clipCount,
		wordCount,
	};
}

function findActiveClip({
	clips,
	timeSeconds,
}: {
	clips: NeutralCaptionClip[];
	timeSeconds: number;
}): NeutralCaptionClip | null {
	let low = 0;
	let high = clips.length - 1;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const clip = clips[mid];
		if (!clip) return null;
		if (timeSeconds < clip.start) {
			high = mid - 1;
		} else if (timeSeconds >= clip.end) {
			low = mid + 1;
		} else {
			return clip;
		}
	}

	return null;
}

function getActiveWordIdsForClip({
	clip,
	wordsById,
	timeSeconds,
}: {
	clip: NeutralCaptionClip;
	wordsById: Map<string, NeutralCaptionWord>;
	timeSeconds: number;
}): string[] {
	return clip.wordIds.filter((wordId) => {
		const word = wordsById.get(wordId);
		return Boolean(word && word.start <= timeSeconds && timeSeconds < word.end);
	});
}

export function getActiveCapinstaCaptionStateFromIndex({
	index,
	timeSeconds,
}: {
	index: CapinstaCaptionTimingIndex;
	timeSeconds: number;
}): ActiveCapinstaCaptionState | null {
	if (!Number.isFinite(timeSeconds)) return null;

	for (const indexedRecord of index.records) {
		const clip = findActiveClip({
			clips: indexedRecord.clips,
			timeSeconds,
		});
		if (!clip) continue;
		return {
			record: indexedRecord.record,
			document: indexedRecord.record.document,
			clip,
			activeWordIds: getActiveWordIdsForClip({
				clip,
				wordsById: indexedRecord.wordsById,
				timeSeconds,
			}),
		};
	}

	return null;
}

export function activeCapinstaCaptionStateKey(
	state: ActiveCapinstaCaptionState | null,
): string {
	if (!state) return "none";
	return `${state.document.id}:${state.clip.id}:${state.activeWordIds.join(",")}`;
}
