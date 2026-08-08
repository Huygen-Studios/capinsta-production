import "opencut-wasm";

declare module "opencut-wasm" {
	export type RustCaptionTimingSource =
		| "provider"
		| "forced_alignment"
		| "repaired_provider"
		| "manual"
		| "estimated";

	export interface RustTimedWord {
		id: string;
		spokenText: string;
		displayText: string;
		startUs: number;
		endUs: number;
		confidence?: number;
		timingSource: RustCaptionTimingSource;
		timingNeedsReview: boolean;
		provider?: string;
		speakerId?: string;
		language?: string;
		vadSegmentId?: string;
		timingDiagnostic?: string;
	}

	export interface RustCaptionPage {
		id: string;
		wordIds: string[];
		startUs: number;
		endUs: number;
		displayTextOverride?: string;
		activeWordEffectsEnabled: boolean;
	}

	export interface RustVadRegion {
		id: string;
		kind: "speech" | "silence";
		startUs: number;
		endUs: number;
		confidence?: number;
	}

	export interface RustCaptionDocument {
		version: "capinsta.caption.v2" | string;
		mediaDurationUs: number;
		timelineOffsetUs: number;
		words: RustTimedWord[];
		pages: RustCaptionPage[];
		vadRegions: RustVadRegion[];
		diagnostics: Record<string, unknown>;
	}

	export interface RustCaptionTimingConfig {
		pauseThresholdUs?: number;
		postWordHoldUs?: number;
		maxWordsPerPage?: number;
		maxCharsPerLine?: number;
		maxPageDurationUs?: number;
		minWordDurationUs?: number;
		tinyOverlapToleranceUs?: number;
		forcedAlignmentConfidenceThreshold?: number;
		useVad?: boolean;
		adaptivePauseThreshold?: boolean;
		allowEstimatedActiveWords?: boolean;
	}

	export function rebuildCaptionPages(options: {
		document: RustCaptionDocument;
		config?: RustCaptionTimingConfig;
	}): RustCaptionDocument;
	export function validateCaptionDocument(options: {
		document: RustCaptionDocument;
		config?: RustCaptionTimingConfig;
	}): {
		document: RustCaptionDocument;
		requiresForcedAlignment: boolean;
	};

	export function canonicalizeCaptionDocument(options: unknown): {
		document: RustCaptionDocument;
		requiresForcedAlignment: boolean;
	};

	export function activeCaptionState(options: {
		document: RustCaptionDocument;
		playbackTimeUs: number;
	}): { pageId: string; activeWordIds: string[] } | undefined;

	export function exportCaptionSrt(options: {
		document: RustCaptionDocument;
	}): string;
	export function exportCaptionVtt(options: {
		document: RustCaptionDocument;
	}): string;
	export function editCaptionPageText(options: {
		document: RustCaptionDocument;
		pageId: string;
		text: string;
	}): {
		document: RustCaptionDocument;
		requiresForcedAlignment: boolean;
	};
	export function editCaptionPageTiming(options: {
		document: RustCaptionDocument;
		pageId: string;
		startUs: number;
		endUs: number;
		durationToleranceUs?: number;
	}): {
		document: RustCaptionDocument;
		requiresForcedAlignment: boolean;
	};
}

export {};
