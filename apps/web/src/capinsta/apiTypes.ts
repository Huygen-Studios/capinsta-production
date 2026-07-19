import type {
	CapinstaLanguageMode,
	CapinstaCaptionOutput,
	CapinstaTimingSource,
	CapinstaTranscriptV1,
} from "./types";

export type CapinstaJobStatus =
	| "queued"
	| "pending"
	| "uploaded"
	| "extracting"
	| "processing"
	| "running"
	| "started"
	| "extracting_audio"
	| "transcribing"
	| "aligning"
	| "normalizing"
	| "romanizing"
	| "chunking"
	| "rendering"
	| "rendering_captions"
	| "finalizing"
	| "saving"
	| "generating_captions"
	| "completed"
	| "complete"
	| "succeeded"
	| "success"
	| "done"
	| "failed"
	| "failure"
	| "error"
	| "cancelled"
	| "canceled"
	| string;

export interface CapinstaHealthResponse {
	status: string;
	service?: string;
	version?: string;
	message?: string | null;
	provider_keys?: Record<string, boolean>;
	dependencies?: Record<string, boolean | string>;
}

export interface CapinstaJobCreateResponse {
	job_id: string;
	status: CapinstaJobStatus;
	progress: number;
	filename: string;
	target_lang?: string;
	languageMode?: string;
	video_url?: string;
}

export interface CapinstaApiWord {
	word?: string;
	text?: string;
	displayedWord?: string;
	displayWord?: string;
	originalWord?: string;
	spokenWord?: string;
	start?: number;
	end?: number;
	score?: number;
	confidence?: number;
	provider?: string;
	timingSource?: string;
	timing_source?: string;
	timingSourceDetail?: string;
	timingWarning?: string;
	timing_warning?: string;
	languageHint?: string;
	timingNeedsReview?: boolean;
	timingReviewRequired?: boolean;
	timing_repair?: string;
	timingRepair?: string;
	disableActiveWordHighlighting?: boolean;
}

export interface CapinstaApiSegment {
	id?: string;
	start: number;
	end: number;
	text: string;
	words?: CapinstaApiWord[];
	disableActiveWordHighlighting?: boolean;
	timingNeedsReview?: boolean;
	timingReviewRequired?: boolean;
}

export interface CapinstaJobDetailResponse extends CapinstaJobCreateResponse {
	error?: string | null;
	message?: string | null;
	details?: string | null;
	currentProvider?: string | null;
	currentChunk?: number | null;
	totalChunks?: number | null;
	heartbeatAt?: string | null;
	workerHeartbeatAt?: string | null;
	updatedAt?: string | null;
	createdAt?: string | null;
	completedAt?: string | null;
	statusVersion?: number | null;
	stage?: string | null;
	elapsedSeconds?: number | null;
	srt?: string | null;
	vtt?: string | null;
	segments?: CapinstaApiSegment[] | null;
	transcript?: {
		languageMode?: string;
		sourceLanguage?: string;
		detectedLanguage?: string;
		outputLanguage?: string;
		transformation?: string;
		provider?:
			| string
			| {
					name?: string;
					model?: string;
					fallback?: boolean;
					fallbackFrom?: string | string[];
			  };
		romanized?: boolean;
		segments?: CapinstaApiSegment[];
		alignedWords?: CapinstaApiWord[];
		metadata?: {
			audio?: {
				duration?: number;
				origin?: "rendered_timeline" | "rendered_selection" | "source_media";
				timelineOffsetUs?: number;
				timelineDurationUs?: number;
			};
			timing?: {
				vad?: {
					silenceGaps?: Array<{ start: number; end: number; duration: number }>;
					speechSegments?: Array<{
						start: number;
						end: number;
						confidence?: number;
					}>;
				};
				report?: Record<string, unknown>;
				[key: string]: unknown;
			};
			sync?: Record<string, unknown>;
			transcription?: {
				provider?:
					| string
					| {
							name?: string;
							model?: string;
							fallback?: boolean;
							fallbackFrom?: string | string[];
					  };
				fallback?: boolean;
				fallbackFrom?: string[];
			};
			stylePreset?: Record<string, unknown>;
		};
	} | null;
	created_at?: string;
	completed_at?: string | null;
}

export interface StartCapinstaCaptionJobInput {
	baseUrl: string;
	file?: File;
	mediaAssetId?: string;
	projectId: string;
	languageMode: CapinstaLanguageMode;
	captionOutput?: CapinstaCaptionOutput;
	/** Position of normalized sample zero on the complete project timeline. */
	timelineOffsetUs?: number;
	timelineDurationUs?: number;
	audioOrigin?: "rendered_timeline" | "rendered_selection" | "source_media";
}

export interface CapinstaTranscriptNormalizeInput {
	job: CapinstaJobDetailResponse;
	sourceAsset: {
		assetId: string;
		assetName: string;
		durationSeconds?: number;
		mimeType?: string;
	};
}

export type { CapinstaTimingSource, CapinstaTranscriptV1 };
