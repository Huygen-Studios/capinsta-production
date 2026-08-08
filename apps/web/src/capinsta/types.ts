import type { CapinstaCaptionStyleV1 } from "./styles/styleTypes";
import type { RustCaptionDocument } from "opencut-wasm";

export type CapinstaTranscriptVersion = "capinsta.transcript.v1";

export type CapinstaLanguageMode =
	| "auto"
	| "english"
	| "hindi"
	| "telugu"
	| "hinglish"
	| "telgish"
	| "auto_mixed_indian";

export type CapinstaCaptionOutput =
	| "original"
	| "english"
	| "hindi"
	| "telugu"
	| "hinglish"
	| "telgish";

export type CapinstaTimingSource =
	| "provider"
	| "whisperx"
	| "stable_ts"
	| "vad_adjusted"
	| "forced_alignment"
	| "repaired_provider"
	| "manual"
	| "estimated";

export interface CapinstaSourceAssetV1 {
	assetId: string;
	assetName: string;
	durationSeconds: number;
	mimeType?: string;
}

export interface CapinstaProviderMetadataV1 {
	name:
		| "gemini"
		| "sarvam"
		| "openai_whisper"
		| "groq_whisper"
		| "unknown"
		| string;
	model?: string;
	requestId?: string;
	fallback?: boolean;
	fallbackFrom?: string | string[];
}

export interface CapinstaTranscriptClipV1 {
	id: string;
	start: number;
	end: number;
	text: string;
	wordIds: string[];
	trackId?: string;
	manuallyEdited?: boolean;
	timingNeedsReview?: boolean;
	disableActiveWordHighlighting?: boolean;
}

export interface CapinstaTranscriptWordV1 {
	id: string;
	text: string;
	displayedText: string;
	start: number;
	end: number;
	timingSource: CapinstaTimingSource;
	originalText?: string;
	spokenText?: string;
	confidence?: number;
	score?: number;
	provider?: string;
	languageHint?: "english" | "hindi" | "telugu" | "unknown";
	timingSourceDetail?: string;
	timingWarning?: string;
	timingNeedsReview?: boolean;
	timingRepair?: string;
	captionClipId?: string;
	disableActiveWordHighlighting?: boolean;
}

export interface CapinstaStylePresetMetadataV1 {
	id: string;
	name?: string;
	renderer?: string;
	styleConfig?: Record<string, unknown>;
	chunkingConfig?: Record<string, unknown>;
}

export interface CapinstaManualEditMetadataV1 {
	editedAt?: string;
	editedBy?: string;
	changedClipIds?: string[];
	changedWordIds?: string[];
	globalOffsetSeconds?: number;
	notes?: string[];
}

export interface CapinstaTimingMetadataV1 {
	sourceOfTruth: "words" | "clips";
	generatedAt: string;
	audioDurationSeconds?: number;
	timelineOffsetSeconds?: number;
	timelineOffsetUs?: number;
	audioOrigin?: "rendered_timeline" | "rendered_selection" | "source_media";
	silenceGaps?: Array<{ start: number; end: number; duration: number }>;
	speechSegments?: Array<{ start: number; end: number; confidence?: number }>;
	report?: Record<string, unknown>;
	sync?: Record<string, unknown>;
}

export interface CapinstaTranscriptV1 {
	version: CapinstaTranscriptVersion;
	source: CapinstaSourceAssetV1;
	languageMode: CapinstaLanguageMode;
	sourceLanguage?: CapinstaLanguageMode;
	detectedLanguage?: CapinstaLanguageMode;
	outputLanguage?: CapinstaCaptionOutput;
	transformation?:
		| "none"
		| "translation"
		| "transliteration"
		| "script_conversion";
	provider: CapinstaProviderMetadataV1;
	clips: CapinstaTranscriptClipV1[];
	words: CapinstaTranscriptWordV1[];
	stylePreset: CapinstaStylePresetMetadataV1;
	manualEdits: CapinstaManualEditMetadataV1;
	timing: CapinstaTimingMetadataV1;
}

export interface NeutralCaptionWord {
	id: string;
	text: string;
	displayedText: string;
	start: number;
	end: number;
	timingSource: CapinstaTimingSource;
	originalText?: string;
	spokenText?: string;
	confidence?: number;
	score?: number;
	provider?: string;
	languageHint?: "english" | "hindi" | "telugu" | "unknown";
	timingSourceDetail?: string;
	timingWarning?: string;
	timingNeedsReview?: boolean;
	timingRepair?: string;
	disableActiveWordHighlighting?: boolean;
	sourceWordId: string;
	manualOriginalStart?: number;
	manualOriginalEnd?: number;
}

export interface NeutralCaptionClip {
	id: string;
	trackId: string;
	start: number;
	end: number;
	text: string;
	wordIds: string[];
	stylePresetId: string;
	selected: boolean;
	editable: boolean;
	manuallyEdited: boolean;
	timingNeedsReview: boolean;
	timingSource: CapinstaTimingSource;
	disableActiveWordHighlighting?: boolean;
	style?: CapinstaCaptionStyleV1;
	styleOverrides?: import("./styles/styleTypes").CapinstaCaptionStylePatch;
	manualEdit?: {
		textEditedAt?: string;
		timingEditedAt?: string;
		originalText?: string;
		originalStart?: number;
		originalEnd?: number;
		timingReviewReason?: "text_word_count_changed" | "clip_duration_changed";
	};
	sourceClipId: string;
}

export interface NeutralCaptionDocument {
	id: string;
	trackId: string;
	sourceTranscriptRef: {
		version: CapinstaTranscriptVersion;
		sourceAssetId: string;
		sourceAssetName: string;
		provider: string;
		providerFallback?: boolean;
		providerFallbackFrom?: string | string[];
	};
	durationSeconds: number;
	languageMode: CapinstaLanguageMode;
	sourceLanguage?: CapinstaLanguageMode;
	detectedLanguage?: CapinstaLanguageMode;
	outputLanguage?: CapinstaCaptionOutput;
	transformation?:
		| "none"
		| "translation"
		| "transliteration"
		| "script_conversion";
	stylePresetId: string;
	style?: CapinstaCaptionStyleV1;
	styleOverrides?: import("./styles/styleTypes").CapinstaCaptionStylePatch;
	clips: NeutralCaptionClip[];
	words: NeutralCaptionWord[];
	manualEdits: CapinstaManualEditMetadataV1;
	timing: CapinstaTimingMetadataV1;
	/** Immutable Rust-owned word/page timing used by every production consumer. */
	canonicalTiming?: RustCaptionDocument;
}

export interface CapinstaCaptionDocumentRecord {
	document: NeutralCaptionDocument;
	openCutTrackId: string;
	importedAt: string;
}
