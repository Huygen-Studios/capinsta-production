import { MAX_CLIP_DURATION_MS } from "./constants";
import * as clipWasm from "opencut-wasm";

export type ClipRange = { sourceStartMs: number; sourceEndMs: number };
export type ClipRangeAdjustment = "start" | "end" | "body";

function parseClipRange(value: unknown): ClipRange {
	if (!value || typeof value !== "object")
		throw new TypeError("Rust returned an invalid clip range");
	const sourceStartMs = Reflect.get(value, "sourceStartMs");
	const sourceEndMs = Reflect.get(value, "sourceEndMs");
	if (!Number.isInteger(sourceStartMs) || !Number.isInteger(sourceEndMs))
		throw new TypeError("Rust returned an invalid clip range");
	return {
		sourceStartMs: Number(sourceStartMs),
		sourceEndMs: Number(sourceEndMs),
	};
}

export function initialClipRanges({
	sourceDurationMs,
	count,
	maximumDurationMs = MAX_CLIP_DURATION_MS,
}: {
	sourceDurationMs: number;
	count: number;
	maximumDurationMs?: number;
}) {
	const value: unknown = clipWasm.initialLocalClipRanges(
		sourceDurationMs,
		count,
		maximumDurationMs,
	);
	if (!Array.isArray(value))
		throw new TypeError("Rust returned invalid clip ranges");
	return value.map(parseClipRange);
}

export function adjustClipRange({
	range,
	mode,
	deltaMs,
	sourceDurationMs,
	maximumDurationMs = MAX_CLIP_DURATION_MS,
}: {
	range: ClipRange;
	mode: ClipRangeAdjustment;
	deltaMs: number;
	sourceDurationMs: number;
	maximumDurationMs?: number;
}): ClipRange {
	return parseClipRange(
		clipWasm.adjustLocalClipRange(
			range.sourceStartMs,
			range.sourceEndMs,
			mode,
			deltaMs,
			sourceDurationMs,
			maximumDurationMs,
		),
	);
}

export const sourceToClipTime = ({
	sourceTimeMs,
	range,
}: {
	sourceTimeMs: number;
	range: ClipRange;
}) =>
	clipWasm.sourceToLocalClipTime(
		sourceTimeMs,
		range.sourceStartMs,
		range.sourceEndMs,
	);

export const clipToSourceTime = ({
	clipTimeMs,
	range,
}: {
	clipTimeMs: number;
	range: ClipRange;
}) =>
	clipWasm.localClipToSourceTime(
		clipTimeMs,
		range.sourceStartMs,
		range.sourceEndMs,
	);

export const sanitizeClipFilename = (title: string) =>
	clipWasm.sanitizeLocalClipFilename(title);

export const formatClipTimecode = (milliseconds: number) =>
	clipWasm.formatLocalClipTimecode(milliseconds);

export function parseClipTimecode(value: string): number | null {
	try {
		return clipWasm.parseLocalClipTimecode(value);
	} catch {
		return null;
	}
}
