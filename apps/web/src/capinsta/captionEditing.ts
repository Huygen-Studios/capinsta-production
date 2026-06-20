import type {
	NeutralCaptionClip,
	NeutralCaptionDocument,
	NeutralCaptionWord,
} from "./types";
import { generateUUID } from "@/utils/id";

const MIN_DURATION = 0.001;

export function formatSubtitleTime(seconds: number): string {
	const milliseconds = Math.max(0, Math.round(seconds * 1000));
	const hours = Math.floor(milliseconds / 3_600_000);
	const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
	const secs = Math.floor((milliseconds % 60_000) / 1000);
	const millis = milliseconds % 1000;
	return `${hours.toString().padStart(2, "0")}:${minutes
		.toString()
		.padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${millis
		.toString()
		.padStart(3, "0")}`;
}

export function parseSubtitleTime(value: string): number | null {
	const normalized = value.trim().replace(",", ".");
	const match = normalized.match(
		/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/,
	);
	if (!match) return null;
	const hours = Number(match[1] ?? 0);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	const millis = Number((match[4] ?? "").padEnd(3, "0") || 0);
	if (
		![hours, minutes, seconds, millis].every(Number.isFinite) ||
		minutes >= 60 ||
		seconds >= 60
	) {
		return null;
	}
	return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000 + millis) /
		1000;
}

export function validateSegmentTiming({
	start,
	end,
	mediaDuration,
}: {
	start: number;
	end: number;
	mediaDuration: number;
}): string | null {
	if (!Number.isFinite(start) || !Number.isFinite(end)) {
		return "Enter a valid time.";
	}
	if (start < 0) return "Start time cannot be negative.";
	if (end <= start) return "End time must be after start time.";
	if (end > mediaDuration + 0.0005) {
		return "Timing cannot exceed the media duration.";
	}
	return null;
}

function tokens(text: string): string[] {
	return text.match(/\S+/gu) ?? [];
}

function wordText(word: NeutralCaptionWord): string {
	return word.displayedText || word.text;
}

function distributeWords({
	clip,
	nextTokens,
	existingWords,
}: {
	clip: NeutralCaptionClip;
	nextTokens: string[];
	existingWords: NeutralCaptionWord[];
}): NeutralCaptionWord[] {
	const duration = Math.max(MIN_DURATION, clip.end - clip.start);
	const slice = duration / Math.max(1, nextTokens.length);
	const unused = new Set(existingWords.map((_, index) => index));
	return nextTokens.map((text, index) => {
		let matchedIndex = existingWords.findIndex(
			(word, candidate) =>
				unused.has(candidate) && wordText(word).toLocaleLowerCase() === text.toLocaleLowerCase(),
		);
		if (matchedIndex < 0 && index < existingWords.length && unused.has(index)) {
			matchedIndex = index;
		}
		const matched = matchedIndex >= 0 ? existingWords[matchedIndex] : undefined;
		if (matchedIndex >= 0) unused.delete(matchedIndex);
		const start = Math.round((clip.start + index * slice) * 1000) / 1000;
		const end =
			index === nextTokens.length - 1
				? clip.end
				: Math.round((clip.start + (index + 1) * slice) * 1000) / 1000;
		return {
			...(matched ?? {
				id: generateUUID(),
				sourceWordId: generateUUID(),
				timingSource: "manual" as const,
			}),
			text,
			displayedText: text,
			originalText: matched?.originalText ?? matched?.displayedText ?? text,
			start,
			end: Math.max(start + MIN_DURATION, end),
			timingSource: "manual",
			timingNeedsReview: false,
		};
	});
}

export function updateSegmentText({
	document,
	clipId,
	text,
}: {
	document: NeutralCaptionDocument;
	clipId: string;
	text: string;
}): NeutralCaptionDocument {
	const clip = document.clips.find((item) => item.id === clipId);
	if (!clip) return document;
	const nextTokens = tokens(text);
	const wordMap = new Map(document.words.map((word) => [word.id, word]));
	const existingWords = clip.wordIds
		.map((id) => wordMap.get(id))
		.filter((word): word is NeutralCaptionWord => Boolean(word));
	const nextWords =
		nextTokens.length === existingWords.length
			? existingWords.map((word, index) => ({
					...word,
					text: nextTokens[index]!,
					displayedText: nextTokens[index]!,
					originalText: word.originalText ?? word.displayedText,
					timingNeedsReview: false,
				}))
			: distributeWords({ clip, nextTokens, existingWords });
	const oldIds = new Set(clip.wordIds);
	const nextIds = nextWords.map((word) => word.id);
	return {
		...document,
		clips: document.clips.map((item) =>
			item.id === clipId
				? {
						...item,
						text,
						wordIds: nextIds,
						manuallyEdited: true,
						timingNeedsReview: false,
						manualEdit: {
							...item.manualEdit,
							originalText: item.manualEdit?.originalText ?? item.text,
							textEditedAt: new Date().toISOString(),
						},
					}
				: item,
		),
		words: [
			...document.words.filter((word) => !oldIds.has(word.id)),
			...nextWords,
		].sort((a, b) => a.start - b.start || a.end - b.end),
		manualEdits: {
			...document.manualEdits,
			editedAt: new Date().toISOString(),
			changedClipIds: Array.from(
				new Set([...(document.manualEdits.changedClipIds ?? []), clipId]),
			),
			changedWordIds: Array.from(
				new Set([
					...(document.manualEdits.changedWordIds ?? []),
					...nextIds,
				]),
			),
		},
	};
}

export function updateSegmentTiming({
	document,
	clipId,
	start,
	end,
}: {
	document: NeutralCaptionDocument;
	clipId: string;
	start: number;
	end: number;
}): NeutralCaptionDocument {
	const clip = document.clips.find((item) => item.id === clipId);
	if (!clip) return document;
	const oldDuration = Math.max(MIN_DURATION, clip.end - clip.start);
	const nextDuration = end - start;
	const ids = new Set(clip.wordIds);
	return {
		...document,
		clips: document.clips.map((item) =>
			item.id === clipId
				? {
						...item,
						start,
						end,
						manuallyEdited: true,
						timingSource: "manual",
						timingNeedsReview: false,
						manualEdit: {
							...item.manualEdit,
							originalStart: item.manualEdit?.originalStart ?? item.start,
							originalEnd: item.manualEdit?.originalEnd ?? item.end,
							timingEditedAt: new Date().toISOString(),
						},
					}
				: item,
		),
		words: document.words.map((word) => {
			if (!ids.has(word.id)) return word;
			const relativeStart = (word.start - clip.start) / oldDuration;
			const relativeEnd = (word.end - clip.start) / oldDuration;
			const wordStart = start + Math.max(0, Math.min(1, relativeStart)) * nextDuration;
			const wordEnd = start + Math.max(relativeStart, Math.min(1, relativeEnd)) * nextDuration;
			return {
				...word,
				start: Math.round(wordStart * 1000) / 1000,
				end: Math.min(end, Math.max(wordStart + MIN_DURATION, Math.round(wordEnd * 1000) / 1000)),
				timingSource: "manual",
			};
		}),
	};
}

export function updateWord({
	document,
	clipId,
	wordId,
	text,
	start,
	end,
}: {
	document: NeutralCaptionDocument;
	clipId: string;
	wordId: string;
	text: string;
	start: number;
	end: number;
}): NeutralCaptionDocument {
	const clip = document.clips.find((item) => item.id === clipId);
	if (!clip) return document;
	const requestedWords = document.words.map((word) =>
		word.id === wordId
			? { ...word, text, displayedText: text, start, end, timingSource: "manual" as const }
			: word,
	);
	const requestedLookup = new Map(requestedWords.map((word) => [word.id, word]));
	let previousEnd = clip.start;
	const normalizedClipWords = clip.wordIds
		.map((id) => requestedLookup.get(id))
		.filter((word): word is NeutralCaptionWord => Boolean(word))
		.map((word, index, ordered) => {
			const remaining = ordered.length - index - 1;
			const latestEnd = clip.end - remaining * MIN_DURATION;
			const normalizedStart = Math.max(
				clip.start,
				Math.min(latestEnd - MIN_DURATION, Math.max(previousEnd, word.start)),
			);
			const normalizedEnd = Math.min(
				latestEnd,
				Math.max(normalizedStart + MIN_DURATION, word.end),
			);
			previousEnd = normalizedEnd;
			return {
				...word,
				start: Math.round(normalizedStart * 1000) / 1000,
				end: Math.round(normalizedEnd * 1000) / 1000,
			};
		});
	const normalizedById = new Map(normalizedClipWords.map((word) => [word.id, word]));
	const words = requestedWords.map((word) => normalizedById.get(word.id) ?? word);
	const lookup = new Map(words.map((word) => [word.id, word]));
	const clipText = clip.wordIds
		.map((id) => lookup.get(id))
		.filter((word): word is NeutralCaptionWord => Boolean(word))
		.map(wordText)
		.join(" ");
	return {
		...document,
		words,
		clips: document.clips.map((item) =>
			item.id === clipId ? { ...item, text: clipText, manuallyEdited: true } : item,
		),
	};
}

export function deleteWord({
	document,
	clipId,
	wordId,
}: {
	document: NeutralCaptionDocument;
	clipId: string;
	wordId: string;
}): NeutralCaptionDocument {
	const clip = document.clips.find((item) => item.id === clipId);
	if (!clip) return document;
	const wordIds = clip.wordIds.filter((id) => id !== wordId);
	const words = document.words.filter((word) => word.id !== wordId);
	const lookup = new Map(words.map((word) => [word.id, word]));
	return {
		...document,
		words,
		clips: document.clips.map((item) =>
			item.id === clipId
				? {
						...item,
						wordIds,
						text: wordIds
							.map((id) => lookup.get(id))
							.filter((word): word is NeutralCaptionWord => Boolean(word))
							.map(wordText)
							.join(" "),
						manuallyEdited: true,
					}
				: item,
		),
	};
}

export function addWord({
	document,
	clipId,
}: {
	document: NeutralCaptionDocument;
	clipId: string;
}): NeutralCaptionDocument {
	const clip = document.clips.find((item) => item.id === clipId);
	if (!clip) return document;
	return updateSegmentText({
		document,
		clipId,
		text: `${clip.text}${clip.text ? " " : ""}word`,
	});
}

export function deleteSegment({
	document,
	clipId,
}: {
	document: NeutralCaptionDocument;
	clipId: string;
}): NeutralCaptionDocument {
	const clip = document.clips.find((item) => item.id === clipId);
	if (!clip) return document;
	const ids = new Set(clip.wordIds);
	return {
		...document,
		clips: document.clips.filter((item) => item.id !== clipId),
		words: document.words.filter((word) => !ids.has(word.id)),
	};
}

export function addSegment({
	document,
	at,
	duration = 1.5,
}: {
	document: NeutralCaptionDocument;
	at: number;
	duration?: number;
}): NeutralCaptionDocument {
	const ordered = [...document.clips].sort((a, b) => a.start - b.start);
	const desired = Math.max(0, Math.min(document.durationSeconds - MIN_DURATION, at));
	const previous = [...ordered].reverse().find((clip) => clip.end <= desired);
	const next = ordered.find((clip) => clip.start >= desired);
	const start = Math.max(previous?.end ?? 0, desired);
	const availableEnd = next?.start ?? document.durationSeconds;
	const end = Math.min(availableEnd, start + duration);
	if (end - start < MIN_DURATION) {
		const gaps = [
			{ start: 0, end: ordered[0]?.start ?? document.durationSeconds },
			...ordered.map((clip, index) => ({
				start: clip.end,
				end: ordered[index + 1]?.start ?? document.durationSeconds,
			})),
		];
		const gap = gaps.find((candidate) => candidate.end - candidate.start >= MIN_DURATION);
		if (!gap) return document;
		return addSegment({ document, at: gap.start, duration });
	}
	const id = generateUUID();
	const clip: NeutralCaptionClip = {
		id,
		sourceClipId: id,
		trackId: document.trackId,
		start,
		end,
		text: "",
		wordIds: [],
		stylePresetId: document.stylePresetId,
		style: document.style,
		selected: false,
		editable: true,
		manuallyEdited: true,
		timingNeedsReview: false,
		timingSource: "manual",
	};
	return {
		...document,
		clips: [...document.clips, clip].sort((a, b) => a.start - b.start),
	};
}

export function mergeSegments({
	document,
	firstId,
	secondId,
}: {
	document: NeutralCaptionDocument;
	firstId: string;
	secondId: string;
}): NeutralCaptionDocument {
	const first = document.clips.find((clip) => clip.id === firstId);
	const second = document.clips.find((clip) => clip.id === secondId);
	if (!first || !second) return document;
	const ordered = [first, second].sort((a, b) => a.start - b.start);
	const merged = {
		...ordered[0],
		start: Math.min(first.start, second.start),
		end: Math.max(first.end, second.end),
		text: `${ordered[0].text} ${ordered[1].text}`.replace(/\s+/g, " ").trim(),
		wordIds: [...ordered[0].wordIds, ...ordered[1].wordIds],
		manuallyEdited: true,
	};
	return {
		...document,
		clips: document.clips
			.filter((clip) => clip.id !== firstId && clip.id !== secondId)
			.concat(merged)
			.sort((a, b) => a.start - b.start),
	};
}

export function splitSegment({
	document,
	clipId,
	characterIndex,
}: {
	document: NeutralCaptionDocument;
	clipId: string;
	characterIndex: number;
}): NeutralCaptionDocument {
	const clip = document.clips.find((item) => item.id === clipId);
	if (!clip) return document;
	const leftText = clip.text.slice(0, characterIndex).trim();
	const rightText = clip.text.slice(characterIndex).trim();
	if (!leftText || !rightText) return document;
	const ratio = Math.max(0.05, Math.min(0.95, leftText.length / clip.text.length));
	const lookup = new Map(document.words.map((word) => [word.id, word]));
	const orderedWords = clip.wordIds
		.map((id) => lookup.get(id))
		.filter((word): word is NeutralCaptionWord => Boolean(word));
	const leftWordCount = tokens(leftText).length;
	const timedBoundary = orderedWords[leftWordCount]?.start;
	const splitTime =
		timedBoundary && timedBoundary > clip.start && timedBoundary < clip.end
			? timedBoundary
			: clip.start + (clip.end - clip.start) * ratio;
	const without = deleteSegment({ document, clipId });
	const leftId = generateUUID();
	const rightId = generateUUID();
	const base = { ...clip, wordIds: [], manuallyEdited: true, timingSource: "manual" as const };
	let next: NeutralCaptionDocument = {
		...without,
		clips: [
			...without.clips,
			{ ...base, id: leftId, sourceClipId: leftId, text: leftText, end: splitTime },
			{ ...base, id: rightId, sourceClipId: rightId, text: rightText, start: splitTime },
		].sort((a, b) => a.start - b.start),
	};
	next = updateSegmentText({ document: next, clipId: leftId, text: leftText });
	return updateSegmentText({ document: next, clipId: rightId, text: rightText });
}

export function replaceCaptionText({
	document,
	search,
	replacement,
	clipId,
}: {
	document: NeutralCaptionDocument;
	search: string;
	replacement: string;
	clipId?: string;
}): NeutralCaptionDocument {
	if (!search) return document;
	const targets = clipId
		? document.clips.filter((clip) => clip.id === clipId)
		: document.clips;
	return targets.reduce(
		(current, clip) =>
			updateSegmentText({
				document: current,
				clipId: clip.id,
				text: clip.text.split(search).join(replacement),
			}),
		document,
	);
}
