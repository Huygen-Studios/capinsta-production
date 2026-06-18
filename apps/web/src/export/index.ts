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
