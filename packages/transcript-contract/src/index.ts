/** Derived from contracts/transcript-document-v2.schema.json; do not hand-copy into app shells. */
export type TimingSource =
	| "provider"
	| "aligned"
	| "interpolated"
	| "estimated"
	| "manuallyAdjusted"
	| "unknown";
export interface TranscriptProvider {
	name: string;
	model: string | null;
	requestId: string | null;
	metadata: Record<string, unknown>;
}
export interface TranscriptSegment {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	originalText: string | null;
	speakerId: string | null;
	language: string | null;
	confidence: number | null;
	wordIds: string[];
	timingSource: TimingSource;
	metadata: Record<string, unknown>;
}
export interface TranscriptWord {
	id: string;
	segmentId: string;
	text: string;
	originalText: string | null;
	startMs: number | null;
	endMs: number | null;
	confidence: number | null;
	speakerId: string | null;
	language: string | null;
	timingSource: TimingSource;
	isFiller: boolean;
	isLowConfidence: boolean;
	metadata: Record<string, unknown>;
}
export interface TranscriptSpeaker {
	id: string;
	label: string;
	displayName: string | null;
	confidence: number | null;
	metadata: Record<string, unknown>;
}
export interface SilenceRegion {
	id: string;
	startMs: number;
	endMs: number;
	confidence: number | null;
	source: string;
	metadata: Record<string, unknown>;
}
export interface TranscriptQuality {
	overallScore: number | null;
	timingScore: number | null;
	confidenceScore: number | null;
	lowConfidenceWordCount: number;
	untimedWordCount: number;
	overlapCount: number;
	warnings: string[];
}
export interface TranscriptDocumentV2 {
	schemaVersion: 2;
	transcriptId: string;
	mediaId: string;
	durationMs: number;
	languageMode: string;
	detectedLanguages: string[];
	provider: TranscriptProvider;
	segments: TranscriptSegment[];
	words: TranscriptWord[];
	speakers: TranscriptSpeaker[];
	silenceRegions: SilenceRegion[];
	quality: TranscriptQuality;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}
const sources = new Set<TimingSource>([
	"provider",
	"aligned",
	"interpolated",
	"estimated",
	"manuallyAdjusted",
	"unknown",
]);
const obj = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown): v is number =>
	typeof v === "number" && Number.isInteger(v);
const confidence = (v: unknown) =>
	v === null || (typeof v === "number" && v >= 0 && v <= 1);
/** Runtime boundary validator. Overlapping segments are deliberately valid (with quality warnings). */
export function validateTranscriptDocumentV2(
	value: unknown,
): TranscriptDocumentV2 {
	if (!obj(value) || value.schemaVersion !== 2)
		throw new Error("invalid schemaVersion");
	const d = value as unknown as TranscriptDocumentV2;
	if (
		!int(d.durationMs) ||
		d.durationMs < 0 ||
		!Array.isArray(d.segments) ||
		!Array.isArray(d.words) ||
		!Array.isArray(d.speakers) ||
		!Array.isArray(d.silenceRegions) ||
		!obj(d.provider) ||
		!obj(d.metadata)
	)
		throw new Error("invalid document shape");
	const ids = (items: { id: string }[], name: string) => {
		const set = new Set(items.map((x) => x.id));
		if (set.size !== items.length || [...set].some((id) => !id))
			throw new Error(`duplicate or empty ${name} id`);
		return set;
	};
	const segments = ids(d.segments, "segment"),
		words = ids(d.words, "word"),
		speakers = ids(d.speakers, "speaker");
	ids(d.silenceRegions, "silence region");
	for (const s of d.segments) {
		if (
			!int(s.startMs) ||
			!int(s.endMs) ||
			s.startMs < 0 ||
			s.endMs < s.startMs ||
			s.endMs > d.durationMs ||
			!confidence(s.confidence) ||
			!sources.has(s.timingSource) ||
			!obj(s.metadata) ||
			s.wordIds.some((id) => !words.has(id)) ||
			new Set(s.wordIds).size !== s.wordIds.length ||
			(s.speakerId !== null && !speakers.has(s.speakerId))
		)
			throw new Error("invalid segment");
	}
	for (const w of d.words) {
		if (
			!segments.has(w.segmentId) ||
			!confidence(w.confidence) ||
			!sources.has(w.timingSource) ||
			!obj(w.metadata) ||
			(w.startMs === null) !== (w.endMs === null) ||
			(w.startMs !== null &&
				(!int(w.startMs) ||
					!int(w.endMs) ||
					w.startMs < 0 ||
					w.endMs < w.startMs ||
					w.endMs > d.durationMs)) ||
			(w.speakerId !== null && !speakers.has(w.speakerId))
		)
			throw new Error("invalid word");
	}
	for (const s of d.silenceRegions) {
		if (
			!int(s.startMs) ||
			!int(s.endMs) ||
			s.startMs < 0 ||
			s.endMs < s.startMs ||
			s.endMs > d.durationMs ||
			!confidence(s.confidence) ||
			!obj(s.metadata)
		)
			throw new Error("invalid silence region");
	}
	return d;
}
/** Narrow bridge for existing seconds-based caption consumers; it never invents untimed words. */
export function transcriptDocumentV2ToLegacySegments(
	document: TranscriptDocumentV2,
) {
	return document.segments.map((segment) => ({
		id: segment.id,
		text: segment.text,
		start: segment.startMs / 1000,
		end: segment.endMs / 1000,
		words: segment.wordIds
			.map((id) => document.words.find((word) => word.id === id))
			.filter((word): word is TranscriptWord =>
				Boolean(word && word.startMs !== null && word.endMs !== null),
			)
			.map((word) => ({
				word: word.text,
				displayedWord: word.text,
				originalWord: word.originalText ?? undefined,
				start: word.startMs! / 1000,
				end: word.endMs! / 1000,
				confidence: word.confidence ?? undefined,
				timingSource: word.timingSource,
			})),
	}));
}

export type ClipProjectStatus =
	| "draft"
	| "processing"
	| "ready"
	| "exporting"
	| "exported"
	| "failed"
	| "archived";
export interface ClipSelectionReferenceV1 {
	transcriptId: string | null;
	transcriptRevision: number | null;
	startWordId: string | null;
	endWordId: string | null;
	startSegmentId: string | null;
	endSegmentId: string | null;
}
export interface ClipRangeV1 {
	schemaVersion: 1;
	id: string;
	sourceMediaId: string;
	sourceStartMs: number;
	sourceEndMs: number;
	order: number;
	playbackRate: number;
	selection: ClipSelectionReferenceV1 | null;
	boundary: {
		preRollMs: number;
		postRollMs: number;
		startAdjustedManually: boolean;
		endAdjustedManually: boolean;
	};
	transitionIn: Record<string, unknown> | null;
	transitionOut: Record<string, unknown> | null;
	enabled: boolean;
	label: string | null;
	metadata: Record<string, unknown>;
}
export interface ClipProjectV1 {
	schemaVersion: 1;
	clipProjectId: string;
	workspaceId: string | null;
	name: string;
	sourceMedia: {
		mediaId: string;
		durationMs: number;
		sourceType: "uploaded" | "recorded" | "imported" | "generated" | "unknown";
		displayName: string | null;
		mimeType: string | null;
		storageKey: string | null;
		checksum: string | null;
		metadata: Record<string, unknown>;
	};
	transcriptId: string | null;
	transcriptRevision: number | null;
	ranges: ClipRangeV1[];
	canvas: {
		aspectRatio: "9:16" | "16:9" | "1:1" | "4:5" | "custom";
		width: number;
		height: number;
		background: string | null;
		safeArea: Record<string, unknown> | null;
		metadata: Record<string, unknown>;
	};
	captionTrack: {
		captionTrackId: string;
		transcriptId: string | null;
		stylePresetId: string | null;
		enabled: boolean;
		metadata: Record<string, unknown>;
	} | null;
	settings: {
		defaultPreRollMs: number;
		defaultPostRollMs: number;
		snapToWords: boolean;
		snapToSegments: boolean;
		preserveBreathingRoom: boolean;
		metadata: Record<string, unknown>;
	};
	status: ClipProjectStatus;
	revision: number;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}
export type ClipValidationIssue = {
	category: string;
	fieldPath: string;
	entityId: string | null;
	message: string;
};
const clipInt = (v: unknown): v is number => int(v) && v >= 0;
export function validateClipRangeV1(value: unknown): ClipRangeV1 {
	if (
		!obj(value) ||
		value.schemaVersion !== 1 ||
		typeof value.id !== "string" ||
		!value.id ||
		typeof value.sourceMediaId !== "string" ||
		!value.sourceMediaId ||
		!clipInt(value.sourceStartMs) ||
		!clipInt(value.sourceEndMs) ||
		value.sourceEndMs <= value.sourceStartMs ||
		!clipInt(value.order) ||
		typeof value.playbackRate !== "number" ||
		value.playbackRate < 0.25 ||
		value.playbackRate > 4 ||
		typeof value.enabled !== "boolean" ||
		!obj(value.boundary) ||
		!clipInt(value.boundary.preRollMs) ||
		!clipInt(value.boundary.postRollMs) ||
		!obj(value.metadata)
	)
		throw new Error("invalid_range_duration");
	return value as unknown as ClipRangeV1;
}
export function validateClipProjectV1(value: unknown): ClipProjectV1 {
	if (
		!obj(value) ||
		value.schemaVersion !== 1 ||
		typeof value.clipProjectId !== "string" ||
		!value.clipProjectId ||
		!obj(value.sourceMedia) ||
		typeof value.sourceMedia.mediaId !== "string" ||
		!value.sourceMedia.mediaId ||
		!clipInt(value.sourceMedia.durationMs) ||
		!Array.isArray(value.ranges) ||
		!obj(value.canvas) ||
		!int(value.canvas.width) ||
		!int(value.canvas.height) ||
		value.canvas.width <= 0 ||
		value.canvas.height <= 0 ||
		!obj(value.metadata) ||
		!int(value.revision) ||
		value.revision < 1
	)
		throw new Error("invalid_canvas");
	const p = value as unknown as ClipProjectV1;
	const ids = new Set<string>(),
		orders = new Set<number>();
	for (const raw of p.ranges) {
		const r = validateClipRangeV1(raw);
		if (ids.has(r.id)) throw new Error("duplicate_range_id");
		ids.add(r.id);
		if (r.sourceMediaId !== p.sourceMedia.mediaId)
			throw new Error("media_reference_mismatch");
		if (r.sourceEndMs > p.sourceMedia.durationMs)
			throw new Error("range_exceeds_media");
		if (r.enabled) {
			if (orders.has(r.order)) throw new Error("duplicate_range_order");
			orders.add(r.order);
		}
	}
	return p;
}
export function validateClipProjectAgainstTranscript(
	project: ClipProjectV1,
	transcript: TranscriptDocumentV2 | null,
): ClipValidationIssue[] {
	if (!transcript) return [];
	const issues: ClipValidationIssue[] = [];
	if (project.transcriptId && project.transcriptId !== transcript.transcriptId)
		issues.push({
			category: "transcript_reference_missing",
			fieldPath: "transcriptId",
			entityId: project.clipProjectId,
			message: "project transcript mismatch",
		});
	const words = new Map(transcript.words.map((w, i) => [w.id, { w, i }]));
	const segments = new Set(transcript.segments.map((s) => s.id));
	for (const r of project.ranges) {
		const s = r.selection;
		if (!s) continue;
		for (const [key, items] of [
			["startWordId", words],
			["endWordId", words],
			["startSegmentId", segments],
			["endSegmentId", segments],
		] as const) {
			const id = s[key];
			if (id && !items.has(id))
				issues.push({
					category: "transcript_reference_missing",
					fieldPath: `selection.${key}`,
					entityId: r.id,
					message: "referenced transcript entity is missing",
				});
		}
		if (
			s.startWordId &&
			s.endWordId &&
			words.has(s.startWordId) &&
			words.has(s.endWordId) &&
			words.get(s.startWordId)!.i > words.get(s.endWordId)!.i
		)
			issues.push({
				category: "transcript_reference_reversed",
				fieldPath: "selection",
				entityId: r.id,
				message: "word selection is reversed",
			});
		if (
			s.transcriptRevision &&
			s.transcriptRevision !== project.transcriptRevision
		)
			issues.push({
				category: "transcript_revision_mismatch",
				fieldPath: "selection.transcriptRevision",
				entityId: r.id,
				message: "selection revision is stale",
			});
	}
	return issues;
}
export interface EditDecisionListEntryV1 {
	id: string;
	rangeId: string;
	order: number;
	sourceMediaId: string;
	sourceStartMs: number;
	sourceEndMs: number;
	sourceDurationMs: number;
	outputStartMs: number;
	outputEndMs: number;
	outputDurationMs: number;
	playbackRate: number;
	transitionIn: Record<string, unknown> | null;
	transitionOut: Record<string, unknown> | null;
	metadata: Record<string, unknown>;
}
export interface ClipDomainWarning {
	category: string;
	message: string;
	rangeId: string | null;
}
export interface EditDecisionListV1 {
	schemaVersion: 1;
	clipProjectId: string;
	projectRevision: number;
	sourceMediaId: string;
	sourceDurationMs: number;
	outputDurationMs: number;
	entries: EditDecisionListEntryV1[];
	warnings: ClipDomainWarning[];
	metadata: Record<string, unknown>;
}
export function validateEditDecisionListV1(value: unknown): EditDecisionListV1 {
	if (
		!obj(value) ||
		value.schemaVersion !== 1 ||
		!Array.isArray(value.entries) ||
		!clipInt(value.outputDurationMs) ||
		!obj(value.metadata)
	)
		throw new Error("invalid_edl");
	const e = value.entries as EditDecisionListEntryV1[];
	let cursor = 0;
	const ids = new Set<string>();
	for (const x of e) {
		if (
			!obj(x) ||
			!x.id ||
			ids.has(x.id) ||
			!clipInt(x.outputStartMs) ||
			!clipInt(x.outputEndMs) ||
			x.outputStartMs !== cursor ||
			x.outputEndMs < x.outputStartMs ||
			x.outputDurationMs !== x.outputEndMs - x.outputStartMs ||
			!clipInt(x.sourceStartMs) ||
			!clipInt(x.sourceEndMs)
		)
			throw new Error("invalid_edl");
		ids.add(x.id);
		cursor = x.outputEndMs;
	}
	if (cursor !== value.outputDurationMs) throw new Error("invalid_edl");
	return value as unknown as EditDecisionListV1;
}
export type WordBoundaryPolicy = "contained" | "intersecting" | "clipped";
export type UntimedWordPolicy = "excludeWithWarning" | "preserveUntimed";
export interface TranscriptMappingOptionsV1 {
	boundaryPolicy: WordBoundaryPolicy;
	untimedWordPolicy: UntimedWordPolicy;
}
export interface RemappedWordOccurrenceV1 {
	occurrenceId: string;
	sourceWordId: string;
	sourceSegmentId: string;
	rangeId: string;
	text: string;
	originalText: string | null;
	originalSourceStartMs: number | null;
	originalSourceEndMs: number | null;
	effectiveSourceStartMs: number | null;
	effectiveSourceEndMs: number | null;
	outputStartMs: number | null;
	outputEndMs: number | null;
	speakerId: string | null;
	language: string | null;
	confidence: number | null;
	timingSource: TimingSource;
	isFiller: boolean;
	isLowConfidence: boolean;
	metadata: Record<string, unknown>;
}
export interface RemappedSegmentOccurrenceV1 {
	occurrenceId: string;
	sourceSegmentId: string;
	rangeId: string;
	text: string;
	originalText: string | null;
	originalSourceStartMs: number | null;
	originalSourceEndMs: number | null;
	effectiveSourceStartMs: number | null;
	effectiveSourceEndMs: number | null;
	outputStartMs: number | null;
	outputEndMs: number | null;
	wordOccurrenceIds: string[];
	speakerId: string | null;
	language: string | null;
	confidence: number | null;
	timingSource: TimingSource;
	metadata: Record<string, unknown>;
}
export interface RemappedTranscriptV1 {
	schemaVersion: 1;
	sourceTranscriptId: string;
	clipProjectId: string;
	projectRevision: number;
	sourceMediaId: string;
	outputDurationMs: number;
	segments: RemappedSegmentOccurrenceV1[];
	words: RemappedWordOccurrenceV1[];
	warnings: ClipDomainWarning[];
	metadata: Record<string, unknown>;
}
export function validateRemappedTranscriptV1(
	value: unknown,
): RemappedTranscriptV1 {
	if (
		!obj(value) ||
		value.schemaVersion !== 1 ||
		!clipInt(value.outputDurationMs) ||
		!Array.isArray(value.words) ||
		!Array.isArray(value.segments) ||
		!obj(value.metadata)
	)
		throw new Error("invalid_remapped_transcript");
	const d = value as unknown as RemappedTranscriptV1;
	const validate = (x: {
		occurrenceId: string;
		outputStartMs: number | null;
		outputEndMs: number | null;
		confidence: number | null;
	}) => {
		const { outputStartMs: start, outputEndMs: end } = x;
		return (
			!x.occurrenceId ||
			(start === null) !== (end === null) ||
			(start !== null &&
				end !== null &&
				(!clipInt(start) ||
					!clipInt(end) ||
					start > end ||
					end > d.outputDurationMs)) ||
			!confidence(x.confidence)
		);
	};
	const wordIds = new Set(d.words.map((w) => w.occurrenceId));
	if (wordIds.size !== d.words.length || d.words.some(validate))
		throw new Error("invalid_remapped_transcript");
	const segmentIds = new Set(d.segments.map((s) => s.occurrenceId));
	if (
		segmentIds.size !== d.segments.length ||
		d.segments.some(
			(s) => validate(s) || s.wordOccurrenceIds.some((id) => !wordIds.has(id)),
		)
	)
		throw new Error("invalid_remapped_transcript");
	return d;
}

export type UnsupportedFeaturePolicy = "error" | "warn";
export interface ClipProjectConversionOptionsV1 {
	includeCaptions: boolean;
	preserveDisabledRanges: boolean;
	createSeparateTracks: boolean;
	unsupportedFeaturePolicy: UnsupportedFeaturePolicy;
}
export interface ClipProjectConversionInputV1 {
	schemaVersion: 1;
	clipProject: ClipProjectV1;
	editDecisionList: EditDecisionListV1;
	remappedTranscript: RemappedTranscriptV1 | null;
	targetProjectId: string;
	targetProjectVersion: 35;
	options: ClipProjectConversionOptionsV1;
	metadata: Record<string, unknown>;
}
export type ProjectConversionSeverity = "error" | "warning";
export interface ProjectConversionIssue {
	category: string;
	severity: ProjectConversionSeverity;
	message: string;
	fieldPath: string | null;
	clipProjectId: string | null;
	projectRevision: number | null;
	rangeId: string | null;
	edlEntryId: string | null;
	targetProjectId: string | null;
	timelineElementId: string | null;
	captionOccurrenceId: string | null;
	timingValues: Record<string, number>;
}
export interface RangeMappingV1 {
	rangeId: string;
	edlEntryId: string;
	timelineElementIds: string[];
	trackIds: string[];
	sourceMediaId: string;
	sourceStartMs: number;
	sourceEndMs: number;
	sourceDurationMs: number;
	timelineStartMs: number;
	timelineEndMs: number;
	outputDurationMs: number;
	playbackRate: number;
	order: number;
}
export interface CaptionMappingV1 {
	segmentOccurrenceId: string;
	captionElementId: string;
	sourceWordOccurrenceIds: string[];
	captionWordIds: string[];
}
export interface CapinstaMediaReferenceV1 {
	mediaId: string;
	sourceAssetId: string;
	displayName: string;
	mimeType: string | null;
	durationMs: number;
	requiresMediaAttachment: true;
}
export interface CapinstaClippingProvenanceV1 {
	sourceApplication: "clipper";
	sourceClipProjectId: string;
	sourceClipProjectRevision: number;
	sourceTranscriptId: string | null;
	conversionSchemaVersion: 1;
}
export interface CapinstaConversionProjectV35 {
	metadata: {
		id: string;
		name: string;
		duration: number;
		createdAt: string;
		updatedAt: string;
	};
	scenes: Array<{
		id: string;
		name: string;
		isMain: boolean;
		tracks: {
			overlay: Array<Record<string, unknown>>;
			main: Record<string, unknown>;
			audio: Array<Record<string, unknown>>;
		};
		bookmarks: unknown[];
		createdAt: string;
		updatedAt: string;
	}>;
	currentSceneId: string;
	settings: {
		fps: { numerator: number; denominator: number };
		canvasSize: { width: number; height: number };
		canvasSizeMode: "preset" | "custom";
		lastCustomCanvasSize: { width: number; height: number } | null;
		originalCanvasSize: { width: number; height: number } | null;
		background: { type: "color"; color: string };
	};
	version: 35;
	timelineViewState: {
		zoomLevel: number;
		scrollLeft: number;
		playheadTime: number;
	};
	capinstaCaptionDocuments?: Array<Record<string, unknown>>;
	capinstaClippingProvenance: CapinstaClippingProvenanceV1;
}
export interface CapinstaProjectConversionResultV1 {
	schemaVersion: 1;
	sourceClipProjectId: string;
	sourceClipProjectRevision: number;
	targetProjectId: string;
	project: CapinstaConversionProjectV35;
	mediaReference: CapinstaMediaReferenceV1;
	mapping: {
		sourceMediaId: string;
		capinstaMediaId: string;
		rangeMappings: RangeMappingV1[];
		captionMappings: CaptionMappingV1[];
	};
	warnings: ProjectConversionIssue[];
	metadata: Record<string, unknown>;
}

export function validateClipProjectConversionInputV1(
	value: unknown,
): ClipProjectConversionInputV1 {
	if (
		!obj(value) ||
		value.schemaVersion !== 1 ||
		typeof value.targetProjectId !== "string" ||
		!value.targetProjectId ||
		value.targetProjectVersion !== 35 ||
		!obj(value.options) ||
		typeof value.options.includeCaptions !== "boolean" ||
		typeof value.options.preserveDisabledRanges !== "boolean" ||
		typeof value.options.createSeparateTracks !== "boolean" ||
		!["error", "warn"].includes(
			String(value.options.unsupportedFeaturePolicy),
		) ||
		!obj(value.metadata)
	)
		throw new Error("invalid_conversion_input");
	const clipProject = validateClipProjectV1(value.clipProject);
	const edl = validateEditDecisionListV1(value.editDecisionList);
	if (edl.clipProjectId !== clipProject.clipProjectId)
		throw new Error("clip_project_edl_mismatch");
	if (edl.projectRevision !== clipProject.revision)
		throw new Error("project_revision_mismatch");
	if (
		edl.sourceMediaId !== clipProject.sourceMedia.mediaId ||
		edl.sourceDurationMs !== clipProject.sourceMedia.durationMs
	)
		throw new Error("source_media_mismatch");
	if (value.remappedTranscript !== null) {
		const remapped = validateRemappedTranscriptV1(value.remappedTranscript);
		if (
			remapped.clipProjectId !== clipProject.clipProjectId ||
			remapped.projectRevision !== clipProject.revision ||
			remapped.sourceMediaId !== clipProject.sourceMedia.mediaId ||
			remapped.outputDurationMs !== edl.outputDurationMs
		)
			throw new Error("caption_mapping_mismatch");
	}
	return value as unknown as ClipProjectConversionInputV1;
}

export function validateCapinstaProjectConversionResultV1(
	value: unknown,
): CapinstaProjectConversionResultV1 {
	if (
		!obj(value) ||
		value.schemaVersion !== 1 ||
		typeof value.targetProjectId !== "string" ||
		!value.targetProjectId ||
		!obj(value.project) ||
		value.project.version !== 35 ||
		!obj(value.project.metadata) ||
		value.project.metadata.id !== value.targetProjectId ||
		!clipInt(value.project.metadata.duration) ||
		!Array.isArray(value.project.scenes) ||
		value.project.scenes.length !== 1 ||
		!obj(value.project.settings) ||
		!obj(value.project.settings.canvasSize) ||
		!int(value.project.settings.canvasSize.width) ||
		!int(value.project.settings.canvasSize.height) ||
		value.project.settings.canvasSize.width <= 0 ||
		value.project.settings.canvasSize.height <= 0 ||
		!obj(value.project.capinstaClippingProvenance) ||
		!obj(value.mediaReference) ||
		value.mediaReference.requiresMediaAttachment !== true ||
		!obj(value.mapping) ||
		!Array.isArray(value.mapping.rangeMappings) ||
		!Array.isArray(value.mapping.captionMappings) ||
		!Array.isArray(value.warnings) ||
		!obj(value.metadata)
	)
		throw new Error("invalid_conversion_result");
	const result = value as unknown as CapinstaProjectConversionResultV1;
	if (
		result.sourceClipProjectId !==
			result.project.capinstaClippingProvenance.sourceClipProjectId ||
		result.sourceClipProjectRevision !==
			result.project.capinstaClippingProvenance.sourceClipProjectRevision ||
		result.mapping.sourceMediaId !== result.mediaReference.mediaId ||
		result.mapping.capinstaMediaId !== result.mediaReference.mediaId
	)
		throw new Error("invalid_conversion_result");
	let cursor = 0;
	const ids = new Set<string>();
	for (const mapping of result.mapping.rangeMappings) {
		if (
			!mapping.rangeId ||
			!mapping.edlEntryId ||
			mapping.timelineElementIds.length < 1 ||
			mapping.trackIds.length < 1 ||
			mapping.timelineStartMs !== cursor ||
			mapping.timelineEndMs < mapping.timelineStartMs ||
			mapping.outputDurationMs !==
				mapping.timelineEndMs - mapping.timelineStartMs ||
			mapping.sourceEndMs < mapping.sourceStartMs ||
			mapping.sourceDurationMs !==
				mapping.sourceEndMs - mapping.sourceStartMs ||
			mapping.timelineElementIds.some((id) => !id || ids.has(id))
		)
			throw new Error("timeline_mapping_mismatch");
		mapping.timelineElementIds.forEach((id) => ids.add(id));
		cursor = mapping.timelineEndMs;
	}
	if (cursor * 120 !== result.project.metadata.duration)
		throw new Error("invalid_timeline_duration");
	for (const warning of result.warnings) {
		if (
			!warning.category ||
			warning.severity !== "warning" ||
			!warning.message ||
			!obj(warning.timingValues)
		)
			throw new Error("invalid_conversion_issue");
	}
	return result;
}

/** Derived from contracts/capinsta-project-handoff-manifest-v1.schema.json. */
export interface ServerBackedMediaDescriptorV1 {
	schemaVersion: 1;
	mediaId: string;
	mediaAssetId: string;
	sourceType: "server-backed";
	mediaKind: "video" | "audio" | "image" | "unknown";
	mimeType: string | null;
	displayName: string;
	sizeBytes: number | null;
	durationMs: number;
	width: number | null;
	height: number | null;
	storageProvider: "supabase";
	accessMode: "authenticated-server-backed";
	requiresBrowserPersistence: false;
}
export interface CapinstaProjectHandoffManifestV1 {
	schemaVersion: 1;
	handoffId: string;
	clipProjectId: string;
	clipProjectRevision: number;
	conversionResultIdentity: string;
	targetProjectId: string;
	projectSchemaVersion: 35;
	project: CapinstaConversionProjectV35;
	mediaAttachments: ServerBackedMediaDescriptorV1[];
	provenance: {
		sourceClipProjectId: string;
		sourceClipProjectRevision: number;
		conversionSchemaVersion: 1;
		convertedAt: null;
	};
	expiresAt: string;
	warnings: string[];
	metadata: Record<string, unknown>;
}

function collectHandoffProjectMediaIds(
	project: CapinstaConversionProjectV35,
): Set<string> {
	const result = new Set<string>();
	for (const scene of project.scenes) {
		const tracks = scene.tracks;
		const candidates = [
			tracks.main,
			...tracks.overlay,
			...tracks.audio,
		].filter(obj);
		for (const track of candidates) {
			const elements = Array.isArray(track.elements) ? track.elements : [];
			for (const element of elements) {
				if (
					obj(element) &&
					["video", "audio", "image"].includes(String(element.type)) &&
					typeof element.mediaId === "string"
				) {
					result.add(element.mediaId);
				}
			}
		}
	}
	return result;
}

export function validateCapinstaProjectHandoffManifestV1(
	value: unknown,
): CapinstaProjectHandoffManifestV1 {
	const exactKeys = (
		candidate: Record<string, unknown>,
		expected: readonly string[],
	) =>
		Object.keys(candidate).length === expected.length &&
		Object.keys(candidate).every((key) => expected.includes(key));
	if (
		!obj(value) ||
		!exactKeys(value, [
			"schemaVersion",
			"handoffId",
			"clipProjectId",
			"clipProjectRevision",
			"conversionResultIdentity",
			"targetProjectId",
			"projectSchemaVersion",
			"project",
			"mediaAttachments",
			"provenance",
			"expiresAt",
			"warnings",
			"metadata",
		]) ||
		value.schemaVersion !== 1 ||
		typeof value.handoffId !== "string" ||
		typeof value.clipProjectId !== "string" ||
		!int(value.clipProjectRevision) ||
		value.clipProjectRevision < 1 ||
		typeof value.conversionResultIdentity !== "string" ||
		!/^[0-9a-f]{64}$/.test(value.conversionResultIdentity) ||
		typeof value.targetProjectId !== "string" ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.targetProjectId) ||
		value.projectSchemaVersion !== 35 ||
		!obj(value.project) ||
		!obj(value.project.metadata) ||
		!Array.isArray(value.mediaAttachments) ||
		value.mediaAttachments.length < 1 ||
		!obj(value.provenance) ||
		typeof value.expiresAt !== "string" ||
		!Array.isArray(value.warnings) ||
		!obj(value.metadata)
	) {
		throw new Error("handoff_manifest_invalid");
	}
	const manifest = value as unknown as CapinstaProjectHandoffManifestV1;
	const project = manifest.project;
	if (
		project.version !== 35 ||
		project.metadata.id !== manifest.targetProjectId ||
		!Array.isArray(project.scenes) ||
		project.scenes.length !== 1 ||
		!obj(project.settings) ||
		!obj(project.settings.canvasSize) ||
		!int(project.settings.canvasSize.width) ||
		project.settings.canvasSize.width <= 0 ||
		!int(project.settings.canvasSize.height) ||
		project.settings.canvasSize.height <= 0 ||
		manifest.provenance.sourceClipProjectId !== manifest.clipProjectId ||
		manifest.provenance.sourceClipProjectRevision !==
			manifest.clipProjectRevision ||
		manifest.provenance.conversionSchemaVersion !== 1 ||
		manifest.provenance.convertedAt !== null ||
		!Number.isFinite(Date.parse(manifest.expiresAt))
	) {
		throw new Error("handoff_manifest_invalid");
	}
	const attachmentIds = new Set<string>();
	for (const attachment of manifest.mediaAttachments) {
		if (
			!obj(attachment) ||
			!exactKeys(attachment, [
				"schemaVersion",
				"mediaId",
				"mediaAssetId",
				"sourceType",
				"mediaKind",
				"mimeType",
				"displayName",
				"sizeBytes",
				"durationMs",
				"width",
				"height",
				"storageProvider",
				"accessMode",
				"requiresBrowserPersistence",
			]) ||
			attachment.schemaVersion !== 1 ||
			typeof attachment.mediaId !== "string" ||
			!attachment.mediaId ||
			attachmentIds.has(attachment.mediaId) ||
			typeof attachment.mediaAssetId !== "string" ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				attachment.mediaAssetId,
			) ||
			attachment.sourceType !== "server-backed" ||
			!["video", "audio", "image", "unknown"].includes(
				String(attachment.mediaKind),
			) ||
			!(
				attachment.mimeType === null ||
				typeof attachment.mimeType === "string"
			) ||
			typeof attachment.displayName !== "string" ||
			!attachment.displayName ||
			!(
				attachment.sizeBytes === null ||
				(int(attachment.sizeBytes) && attachment.sizeBytes >= 0)
			) ||
			attachment.storageProvider !== "supabase" ||
			attachment.accessMode !== "authenticated-server-backed" ||
			attachment.requiresBrowserPersistence !== false ||
			!int(attachment.durationMs) ||
			attachment.durationMs < 0 ||
			!(
				attachment.width === null ||
				(int(attachment.width) && attachment.width > 0)
			) ||
			!(
				attachment.height === null ||
				(int(attachment.height) && attachment.height > 0)
			)
		) {
			throw new Error("media_attachment_invalid");
		}
		attachmentIds.add(attachment.mediaId);
	}
	const referenced = collectHandoffProjectMediaIds(project);
	if (
		referenced.size !== attachmentIds.size ||
		[...referenced].some((id) => !attachmentIds.has(id))
	) {
		throw new Error("media_attachment_invalid");
	}
	if (
		new Set(manifest.warnings).size !== manifest.warnings.length ||
		manifest.warnings.some(
			(item, index) =>
				index > 0 && manifest.warnings[index - 1].localeCompare(item) > 0,
		)
	) {
		throw new Error("handoff_manifest_invalid");
	}
	assertPortableHandoffValue(manifest);
	return manifest;
}

function assertPortableHandoffValue(value: unknown, key = ""): void {
	if (typeof value === "string") {
		const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
		if (
			[
				"signedurl",
				"accessurl",
				"downloadurl",
				"storagepath",
				"localpath",
				"filepath",
				"servicerolekey",
				"accesstoken",
				"refreshtoken",
				"authorization",
				"authorizationheaders",
			].includes(normalizedKey) ||
			/^(blob:|file:|[a-z]:[\\/]|\/(?:home|users|tmp|var|private|mnt|opt)\/)/i.test(
				value,
			) ||
			/^https?:\/\/.*(?:token|signature|apikey|x-amz-|x-goog-)/i.test(
				value,
			)
		) {
			throw new Error("handoff_manifest_invalid");
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item) => assertPortableHandoffValue(item, key));
		return;
	}
	if (obj(value)) {
		Object.entries(value).forEach(([childKey, child]) =>
			assertPortableHandoffValue(child, childKey),
		);
	}
}
