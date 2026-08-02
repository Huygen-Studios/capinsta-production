import { MAX_CLIP_DURATION_MS } from "./constants";

export type ClipRange = { sourceStartMs: number; sourceEndMs: number };
export type ClipRangeAdjustment = "start" | "end" | "body";

export function initialClipRanges({ sourceDurationMs, count, maximumDurationMs = MAX_CLIP_DURATION_MS }: { sourceDurationMs: number; count: number; maximumDurationMs?: number }) {
	if (!Number.isInteger(count) || count < 1 || count > 12 || sourceDurationMs < count)
		throw new RangeError("Clip count is outside the supported range");
	if (!Number.isInteger(maximumDurationMs) || maximumDurationMs < 1 || maximumDurationMs > MAX_CLIP_DURATION_MS)
		throw new RangeError("Maximum duration is outside the supported range");
	const slot = sourceDurationMs / count;
	const duration = Math.max(1, Math.min(maximumDurationMs, Math.floor(slot)));
	return Array.from({ length: count }, (_, index) => {
		const sourceStartMs = Math.floor(index * slot);
		return { sourceStartMs, sourceEndMs: Math.min(sourceDurationMs, sourceStartMs + duration) };
	});
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
	const duration = range.sourceEndMs - range.sourceStartMs;
	if (duration < 1 || duration > maximumDurationMs || maximumDurationMs > MAX_CLIP_DURATION_MS || sourceDurationMs < duration)
		throw new RangeError("Clip range is invalid");
	if (mode === "body") {
		const sourceStartMs = Math.max(0, Math.min(sourceDurationMs - duration, range.sourceStartMs + deltaMs));
		return { sourceStartMs, sourceEndMs: sourceStartMs + duration };
	}
	if (mode === "start") {
		return {
			sourceStartMs: Math.max(0, range.sourceEndMs - maximumDurationMs, Math.min(range.sourceEndMs - 1, range.sourceStartMs + deltaMs)),
			sourceEndMs: range.sourceEndMs,
		};
	}
	return {
		sourceStartMs: range.sourceStartMs,
		sourceEndMs: Math.min(sourceDurationMs, range.sourceStartMs + maximumDurationMs, Math.max(range.sourceStartMs + 1, range.sourceEndMs + deltaMs)),
	};
}
