import type { FrameRate } from "opencut-wasm";
import type { CapinstaCaptionDocumentRecord } from "@/capinsta/types";
import type { TScene } from "@/timeline/types";
import type { MediaTime } from "@/wasm";

export type TBackground =
	| {
			type: "color";
			color: string;
	  }
	| {
			type: "blur";
			blurIntensity: number;
	  };

export interface TCanvasSize {
	width: number;
	height: number;
}

export interface TProjectMetadata {
	id: string;
	name: string;
	thumbnail?: string;
	duration: MediaTime;
	createdAt: Date;
	updatedAt: Date;
}

export interface TProjectSettings {
	fps: FrameRate;
	canvasSize: TCanvasSize;
	canvasSizeMode?: "preset" | "custom";
	lastCustomCanvasSize?: TCanvasSize | null;
	originalCanvasSize?: TCanvasSize | null;
	background: TBackground;
}

export interface TTimelineViewState {
	zoomLevel: number;
	scrollLeft: number;
	playheadTime: MediaTime;
}

export interface CapinstaClippingProvenanceV1 {
	sourceApplication: "clipper";
	sourceClipProjectId: string;
	sourceClipProjectRevision: number;
	sourceTranscriptId: string | null;
	conversionSchemaVersion: 1;
}

export type LocalClipPlatformPresetV1 =
	| "instagram_reels"
	| "youtube_shorts"
	| "tiktok"
	| "custom";

export interface LocalClipEditorStateV1 {
	scenes: TScene[];
	currentSceneId: string;
	settings: TProjectSettings;
	timelineViewState?: TTimelineViewState;
	capinstaCaptionDocuments?: CapinstaCaptionDocumentRecord[];
}

export interface LocalClipItemV1 {
	schemaVersion: 1;
	id: string;
	ordinal: number;
	title: string;
	sourceStartMs: number;
	sourceEndMs: number;
	selectedForExport: boolean;
	captionsEnabled: boolean;
	headingEnabled: boolean;
	captionStatus:
		| "idle"
		| "preparing"
		| "uploading"
		| "transcribing"
		| "creating"
		| "completed"
		| "failed";
	exportStatus: "idle" | "waiting" | "rendering" | "complete" | "failed";
	editorProjectState: LocalClipEditorStateV1;
	createdAt: string;
	updatedAt: string;
}

export interface LocalClipBatchV1 {
	schemaVersion: 1;
	id: string;
	title: string;
	sourceMediaId: string;
	sourceFileName: string;
	sourceDurationMs: number;
	sourceMimeType: string;
	platformPreset: LocalClipPlatformPresetV1;
	aspectRatio: TCanvasSize;
	captionsEnabled: boolean;
	headingsEnabled: boolean;
	maximumClipDurationMs: number;
	clipOrder: string[];
	selectedClipId: string | null;
	normalEditorProjectState: LocalClipEditorStateV1;
	items: LocalClipItemV1[];
	createdAt: string;
	updatedAt: string;
}

export interface TProject {
	metadata: TProjectMetadata;
	scenes: TScene[];
	currentSceneId: string;
	settings: TProjectSettings;
	version: number;
	timelineViewState?: TTimelineViewState;
	capinstaCaptionDocuments?: CapinstaCaptionDocumentRecord[];
	capinstaServerJobId?: string;
	capinstaLeftAt?: string;
	capinstaServerMediaAssetId?: string;
	capinstaServerMediaAssetVersion?: number;
	capinstaSourceFingerprint?: string;
	capinstaClippingProvenance?: CapinstaClippingProvenanceV1;
	capinstaLocalClipBatch?: LocalClipBatchV1;
	capinstaEditorMode?: "normal" | "clipping";
}

export type TProjectSortKey = "createdAt" | "updatedAt" | "name" | "duration";
export type TSortOrder = "asc" | "desc";
export type TProjectSortOption = `${TProjectSortKey}-${TSortOrder}`;
