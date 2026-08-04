import type { FrameRate } from "opencut-wasm";
import { EXPORT_MIME_TYPES } from "./mime-types";

export const EXPORT_QUALITY_VALUES = [
	"fast",
	"balanced",
	"low",
	"medium",
	"high",
	"very_high",
] as const;

export const EXPORT_FORMAT_VALUES = ["mp4", "webm"] as const;

export type ExportFormat = (typeof EXPORT_FORMAT_VALUES)[number];
export type ExportQuality = (typeof EXPORT_QUALITY_VALUES)[number];
export type ExportMode = "full_video" | "captions_solid_background";

export interface ExportOptions {
	exportMode: ExportMode;
	format: ExportFormat;
	quality: ExportQuality;
	fps?: FrameRate;
	includeAudio?: boolean;
	backgroundColor?: string;
	canvasSize?: {
		width: number;
		height: number;
	};
	/** Render editable caption carrier text in-browser; used by local Clipping Mode. */
	localCaptionCarriers?: boolean;
}

export interface ExportResult {
	success: boolean;
	buffer?: ArrayBuffer;
	error?: string;
	cancelled?: boolean;
}

export interface ExportState {
	isExporting: boolean;
	progress: number;
	result: ExportResult | null;
}

export function getExportMimeType({
	format,
}: {
	format: ExportFormat;
}): string {
	return EXPORT_MIME_TYPES[format];
}

export function getExportFileExtension({
	format,
}: {
	format: ExportFormat;
}): string {
	return `.${format}`;
}

/**
 * Normalizes an arbitrary error value into a human-readable string.
 *
 * The export pipeline may receive error payloads from external APIs (FastAPI
 * validation errors, etc.) where `error`/`detail` fields can be objects or
 * arrays instead of plain strings. Passing such values to React as JSX children
 * causes a runtime crash ("Objects are not valid as a React child").
 *
 * This utility ensures the value stored in `ExportResult.error` is always a
 * string, serializing objects/arrays to JSON when necessary.
 */
export function normalizeExportError(error: unknown): string {
	if (error == null) return "Unknown error";
	if (typeof error === "string") return error;
	if (error instanceof Error) return error.message;
	if (Array.isArray(error)) {
		return error.map((e) => normalizeExportError(e)).join("; ");
	}
	if (typeof error === "object") {
		try {
			return JSON.stringify(error);
		} catch {
			return String(error);
		}
	}
	return String(error);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exportRecoveryHint(stage: string): string {
	const normalized = stage.trim().toLowerCase();
	if (
		normalized.includes("media") ||
		normalized.includes("project") ||
		normalized.includes("input")
	) {
		return "Confirm the source video is still available, then regenerate captions and retry.";
	}
	if (
		normalized.includes("renderer") ||
		normalized.includes("playwright") ||
		normalized.includes("composition") ||
		normalized.includes("font")
	) {
		return "The render worker could not prepare the caption page. Retry once; if it fails again, share the job and correlation IDs with support.";
	}
	if (
		normalized.includes("ffmpeg") ||
		normalized.includes("encode") ||
		normalized.includes("output")
	) {
		return "The video encoder did not produce a valid MP4. Retry once; if it fails again, share the diagnostic IDs with support.";
	}
	return "Retry the export. If it fails again, share the diagnostic IDs with support.";
}

export function formatExportApiError({
	endpoint,
	status,
	payload,
	correlationId,
	jobId,
}: {
	endpoint: string;
	status?: number;
	payload?: unknown;
	correlationId?: string | null;
	jobId?: string | null;
}): string {
	const data = isUnknownRecord(payload) ? payload : {};
	const stage = normalizeExportError(data.stage ?? "request");
	const backendError = normalizeExportError(
		data.error ??
			data.detail ??
			data.message ??
			payload ??
			"Unknown export error",
	);
	const details = [
		`Export failed during ${stage}: ${backendError}`,
		exportRecoveryHint(stage),
		`Endpoint: ${endpoint}`,
		status !== undefined
			? `HTTP status: ${status}`
			: "HTTP status: unavailable",
		`Backend stage: ${stage}`,
		`Backend error: ${backendError}`,
		jobId ? `Export job ID: ${jobId}` : null,
		correlationId ? `Correlation ID: ${correlationId}` : null,
	].filter((value): value is string => Boolean(value));
	return details.join(" | ");
}

export function downloadBuffer({
	buffer,
	filename,
	mimeType,
}: {
	buffer: ArrayBuffer;
	filename: string;
	mimeType: string;
}): void {
	const blob = new Blob([buffer], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const downloadLink = document.createElement("a");
	downloadLink.href = url;
	downloadLink.download = filename;
	document.body.appendChild(downloadLink);
	downloadLink.click();
	document.body.removeChild(downloadLink);
	URL.revokeObjectURL(url);
}
