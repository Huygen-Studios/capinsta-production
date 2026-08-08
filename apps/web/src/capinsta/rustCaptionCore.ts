import {
	validateCaptionDocument,
	type RustCaptionDocument,
	type RustCaptionTimingConfig,
	type RustTimedWord,
	type RustVadRegion,
} from "opencut-wasm";
import type { CaptionChunkingConfig } from "./original/types";
import type {
	CapinstaTimingMetadataV1,
	CapinstaTimingSource,
	NeutralCaptionWord,
} from "./types";

const US_PER_SECOND = 1_000_000;

export function secondsToMicroseconds(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		throw new Error("caption time must be finite");
	}
	return Math.round(seconds * US_PER_SECOND);
}

export function microsecondsToSeconds(microseconds: number): number {
	if (!Number.isSafeInteger(microseconds)) {
		throw new Error("caption microseconds must be a safe integer");
	}
	return microseconds / US_PER_SECOND;
}

function rustTimingSource(
	source: CapinstaTimingSource,
): RustTimedWord["timingSource"] {
	if (
		source === "whisperx" ||
		source === "stable_ts" ||
		source === "forced_alignment"
	) {
		return "forced_alignment";
	}
	if (source === "vad_adjusted" || source === "repaired_provider") {
		return "repaired_provider";
	}
	return source;
}

function toRustWord(word: NeutralCaptionWord): RustTimedWord {
	return {
		id: word.id,
		spokenText: word.spokenText || word.originalText || word.text,
		displayText: word.displayedText || word.text,
		startUs: secondsToMicroseconds(word.start),
		endUs: secondsToMicroseconds(word.end),
		confidence: word.confidence ?? word.score,
		timingSource: rustTimingSource(word.timingSource),
		timingNeedsReview: Boolean(word.timingNeedsReview),
		provider: word.provider,
		timingDiagnostic: word.timingSourceDetail || word.timingWarning,
	};
}

function toVadRegions(timing: CapinstaTimingMetadataV1): RustVadRegion[] {
	const silence = (timing.silenceGaps ?? []).map((gap, index) => ({
		id: `vad-silence-${index + 1}`,
		kind: "silence" as const,
		startUs: secondsToMicroseconds(gap.start),
		endUs: secondsToMicroseconds(gap.end),
	}));
	const speech = (timing.speechSegments ?? []).map((segment, index) => ({
		id: `vad-speech-${index + 1}`,
		kind: "speech" as const,
		startUs: secondsToMicroseconds(segment.start),
		endUs: secondsToMicroseconds(segment.end),
		confidence: segment.confidence,
	}));
	return [...silence, ...speech].sort(
		(left, right) => left.startUs - right.startUs || left.endUs - right.endUs,
	);
}

function toRustConfig(config: CaptionChunkingConfig): RustCaptionTimingConfig {
	return {
		pauseThresholdUs: secondsToMicroseconds(config.pauseSplitThreshold),
		postWordHoldUs: secondsToMicroseconds(
			Math.min(0.35, Math.max(0.15, config.maxHoldAfterWord ?? 0.25)),
		),
		maxWordsPerPage: config.maxWordsPerCaption,
		maxCharsPerLine: config.maxCharsPerCaption,
		maxPageDurationUs: secondsToMicroseconds(config.maxCaptionDuration),
		minWordDurationUs: secondsToMicroseconds(config.minWordDuration),
		tinyOverlapToleranceUs: 20_000,
		forcedAlignmentConfidenceThreshold: 0.55,
		useVad: true,
		adaptivePauseThreshold: true,
		allowEstimatedActiveWords: false,
	};
}

export function buildRustCaptionPages({
	words,
	durationSeconds,
	timing,
	chunkingConfig,
	timelineOffsetSeconds = timing.timelineOffsetSeconds ?? 0,
}: {
	words: NeutralCaptionWord[];
	durationSeconds: number;
	timing: CapinstaTimingMetadataV1;
	chunkingConfig: CaptionChunkingConfig;
	timelineOffsetSeconds?: number;
}): RustCaptionDocument {
	const document: RustCaptionDocument = {
		version: "capinsta.caption.v2",
		mediaDurationUs: secondsToMicroseconds(durationSeconds),
		timelineOffsetUs: secondsToMicroseconds(timelineOffsetSeconds),
		words: words.map(toRustWord),
		pages: [],
		vadRegions: toVadRegions(timing),
		diagnostics: {
			providerWordCount: words.length,
			timelineOffsetUs: secondsToMicroseconds(timelineOffsetSeconds),
		},
	};
	return validateCaptionDocument({
		document,
		config: toRustConfig(chunkingConfig),
	}).document;
}
