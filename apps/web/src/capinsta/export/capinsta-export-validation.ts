import type { CapinstaCaptionDocumentRecord } from "@/capinsta/types";

export type CapinstaExportValidationSeverity = "ok" | "warning" | "error";

export interface CapinstaExportValidationCheck {
	name: string;
	passed: boolean;
	message?: string;
}

export interface CapinstaExportValidationResult {
	severity: CapinstaExportValidationSeverity;
	checks: CapinstaExportValidationCheck[];
}

interface ValidationBaseInput {
	records: CapinstaCaptionDocumentRecord[];
	canvasWidth: number;
	canvasHeight: number;
}

interface HeadlessValidationInput extends ValidationBaseInput {
	sourceJobId: string;
	sourceMediaAssetId?: string;
}

interface SingleOverlayRendererInput {
	overlayHostsMounted: number;
}

function result(
	checks: CapinstaExportValidationCheck[],
): CapinstaExportValidationResult {
	return {
		severity: checks.some((check) => !check.passed) ? "error" : "ok",
		checks,
	};
}

function hasPositiveCanvas({
	canvasWidth,
	canvasHeight,
}: Pick<ValidationBaseInput, "canvasWidth" | "canvasHeight">) {
	return (
		Number.isFinite(canvasWidth) &&
		canvasWidth > 0 &&
		Number.isFinite(canvasHeight) &&
		canvasHeight > 0
	);
}

function collectDuplicateIds(ids: string[]) {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) duplicates.add(id);
		seen.add(id);
	}
	return duplicates;
}

function validateRecords(
	records: CapinstaCaptionDocumentRecord[],
): CapinstaExportValidationCheck[] {
	const wordIds = records.flatMap((record) =>
		record.document.words.map((word) => word.id),
	);
	const clipIds = records.flatMap((record) =>
		record.document.clips.map((clip) => clip.id),
	);
	const wordIdSet = new Set(wordIds);
	const missingClipWords = records.flatMap((record) =>
		record.document.clips.flatMap((clip) =>
			clip.wordIds
				.filter((wordId) => !wordIdSet.has(wordId))
				.map((wordId) => `${clip.id}:${wordId}`),
		),
	);
	const invalidTiming = records.flatMap((record) =>
		record.document.clips.filter(
			(clip) =>
				!Number.isFinite(clip.start) ||
				!Number.isFinite(clip.end) ||
				clip.end <= clip.start,
		),
	);

	return [
		{
			name: "capinsta-records-present",
			passed: records.length > 0,
			message:
				records.length > 0
					? undefined
					: "No CapInsta caption document records are attached to the project.",
		},
		{
			name: "capinsta-clips-present",
			passed: records.some((record) => record.document.clips.length > 0),
			message: "At least one caption clip is required for CapInsta export.",
		},
		{
			name: "capinsta-words-present",
			passed: records.some((record) => record.document.words.length > 0),
			message:
				"At least one timed caption word is required for CapInsta export.",
		},
		{
			name: "capinsta-unique-clip-ids",
			passed: collectDuplicateIds(clipIds).size === 0,
			message: "Duplicate caption clip ids were found.",
		},
		{
			name: "capinsta-unique-word-ids",
			passed: collectDuplicateIds(wordIds).size === 0,
			message: "Duplicate caption word ids were found.",
		},
		{
			name: "capinsta-clip-word-ids-resolve",
			passed: missingClipWords.length === 0,
			message: missingClipWords.length
				? `Missing clip word references: ${missingClipWords.slice(0, 5).join(", ")}`
				: undefined,
		},
		{
			name: "capinsta-clip-timing-valid",
			passed: invalidTiming.length === 0,
			message: invalidTiming.length
				? "Caption clips must have finite start/end times with end > start."
				: undefined,
		},
	];
}

export function validateCapinstaPreExport(
	input: ValidationBaseInput,
): CapinstaExportValidationResult {
	return result([
		{
			name: "capinsta-canvas-size-valid",
			passed: hasPositiveCanvas(input),
			message:
				"Export canvas width and height must be positive finite numbers.",
		},
		...validateRecords(input.records),
	]);
}

export function validatePreviewExportStyleParity(
	input: ValidationBaseInput,
): CapinstaExportValidationResult {
	const missingStyle = input.records.flatMap((record) =>
		record.document.clips
			.filter((clip) => !clip.style && !record.document.style)
			.map((clip) => clip.id),
	);

	return result([
		{
			name: "capinsta-style-canvas-size-valid",
			passed: hasPositiveCanvas(input),
			message:
				"Style parity validation requires a positive export canvas size.",
		},
		{
			name: "capinsta-preview-export-style-source-present",
			passed: missingStyle.length === 0,
			message: missingStyle.length
				? `Missing style source for clips: ${missingStyle.slice(0, 5).join(", ")}`
				: undefined,
		},
	]);
}

export function validateSingleOverlayRenderer(
	input: SingleOverlayRendererInput,
): CapinstaExportValidationResult {
	return result([
		{
			name: "capinsta-single-overlay-renderer",
			passed:
				Number.isFinite(input.overlayHostsMounted) &&
				input.overlayHostsMounted <= 1,
			message: "Only one CapInsta overlay host may be mounted during export.",
		},
	]);
}

export function validateCapinstaHeadlessExport(
	input: HeadlessValidationInput,
): CapinstaExportValidationResult {
	return result([
		...validateCapinstaPreExport(input).checks,
		{
			name: "capinsta-export-source-present",
			passed:
				/^[a-z0-9_-]{8,}$/i.test(input.sourceJobId) ||
				/^[a-z0-9_-]{8,}$/i.test(input.sourceMediaAssetId ?? ""),
			message:
				"Headless CapInsta export requires a valid caption job or source media asset.",
		},
	]);
}
