import type { MotionTemplateSlotBinding } from "@/timeline";

const TEMPLATE_TIME_TICKS_PER_SECOND = 120_000;

export function resolveTemplateVideoSourceTimeSeconds({
	binding,
	assetDurationSeconds,
	localTimeSeconds,
}: {
	binding: MotionTemplateSlotBinding;
	assetDurationSeconds?: number | null;
	localTimeSeconds: number;
}): number | null {
	const sourceStart = binding.sourceStart ?? 0;
	const sourceEnd =
		binding.sourceEnd ??
		Math.round((assetDurationSeconds ?? 0) * TEMPLATE_TIME_TICKS_PER_SECOND);
	const sourceStartSeconds = sourceStart / TEMPLATE_TIME_TICKS_PER_SECOND;
	const sourceEndSeconds = sourceEnd / TEMPLATE_TIME_TICKS_PER_SECOND;
	const sourceDurationSeconds = sourceEndSeconds - sourceStartSeconds;
	if (
		!Number.isFinite(localTimeSeconds) ||
		!Number.isFinite(sourceStartSeconds) ||
		!Number.isFinite(sourceEndSeconds) ||
		sourceDurationSeconds <= 0
	) {
		return null;
	}

	const safeLocalTime = Math.max(0, localTimeSeconds);
	const playbackMode = binding.playbackMode ?? "loop";
	if (playbackMode === "freeze") {
		return Math.min(sourceEndSeconds, sourceStartSeconds + safeLocalTime);
	}
	if (playbackMode === "trim") {
		const sourceTime = sourceStartSeconds + safeLocalTime;
		return sourceTime > sourceEndSeconds ? null : sourceTime;
	}

	return (
		sourceStartSeconds +
		(((localTimeSeconds % sourceDurationSeconds) + sourceDurationSeconds) %
			sourceDurationSeconds)
	);
}
