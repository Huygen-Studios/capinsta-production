from __future__ import annotations

from collections import Counter
import logging
import math
from typing import Any

from ai_pipeline.renderer import _hard_boundary_between
from ai_pipeline.timing import PRODUCTION_INVALID_TIMING_SOURCES, normalize_timing_source

logger = logging.getLogger(__name__)


class TimingQualityError(RuntimeError):
    def __init__(self, category: str, message: str, report: dict[str, Any]) -> None:
        super().__init__(f"{category}: {message}")
        self.category = category
        self.report = report


def _finite(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    return None


def _word_source(word: dict[str, Any]) -> str:
    return normalize_timing_source(
        word.get("timingSourceCategory") or word.get("timing_source") or word.get("timingSource"),
        word.get("provider"),
    )


def _is_order_adjusted(word: dict[str, Any]) -> bool:
    blob = " ".join(
        str(word.get(key) or "")
        for key in ("timingSourceCategory", "timing_source", "timingSource", "timingSourceDetail")
    ).lower()
    return "stable_ts_order_adjusted" in blob


def validate_final_timing_quality(
    segments: list[dict[str, Any]],
    *,
    pipeline_config: Any,
    vad_report: dict[str, Any],
    sync_report: dict[str, Any],
    resolved_config_sources: dict[str, Any] | None = None,
) -> dict[str, Any]:
    words: list[dict[str, Any]] = []
    for segment in segments:
        words.extend([word for word in segment.get("words") or [] if isinstance(word, dict)])
    words.sort(key=lambda word: (_finite(word.get("start")) or 0.0, _finite(word.get("end")) or 0.0))

    source_counts: Counter[str] = Counter()
    estimated_count = 0
    stable_order_count = 0
    invalid_ranges = 0
    overlap_count = 0
    outside_group_count = 0
    caption_cross_boundary_count = 0
    prev_end: float | None = None

    for word in words:
        source = _word_source(word)
        source_counts[source] += 1
        if source in PRODUCTION_INVALID_TIMING_SOURCES:
            estimated_count += 1
        if _is_order_adjusted(word):
            stable_order_count += 1
        start = _finite(word.get("start"))
        end = _finite(word.get("end"))
        if start is None or end is None or end <= start:
            invalid_ranges += 1
            continue
        source_start = _finite(word.get("sourceStart"))
        source_end = _finite(word.get("sourceEnd"))
        tolerance = 0.035
        if source_start is not None and start < source_start - tolerance:
            outside_group_count += 1
        if source_end is not None and end > source_end + tolerance:
            outside_group_count += 1
        if prev_end is not None and start < prev_end - 0.002:
            overlap_count += 1
        prev_end = max(prev_end or 0.0, end)

    for segment in segments:
        segment_words = [word for word in segment.get("words") or [] if isinstance(word, dict)]
        for left, right in zip(segment_words, segment_words[1:]):
            if _hard_boundary_between(left, right):
                caption_cross_boundary_count += 1
                break
        group_ids = {str(word.get("alignmentGroupId")) for word in segment_words if word.get("alignmentGroupId")}
        if len(group_ids) > 1:
            caption_cross_boundary_count += 1

    total = len(words)
    estimated_ratio = estimated_count / max(1, total)
    stable_ts = sync_report.get("stableTs") if isinstance(sync_report, dict) else {}
    final_report = {
        "totalWords": total,
        "timingSourceCounts": dict(source_counts),
        "estimatedWordCount": estimated_count,
        "estimatedWordRatio": round(estimated_ratio, 4),
        "stableTsOrderAdjustedCount": stable_order_count,
        "stableTsOrderFallbackEnabled": bool(getattr(pipeline_config.alignment, "allowStableTsOrderFallback", False)),
        "stableTsOrderFallbackAppliedWords": int((stable_ts or {}).get("orderFallbackAppliedWords") or 0),
        "invalidRangeCount": invalid_ranges,
        "overlapCount": overlap_count,
        "outsideAlignmentGroupWindowCount": outside_group_count,
        "captionCrossBoundaryCount": caption_cross_boundary_count,
        "alignmentGroupCount": (sync_report.get("alignmentGroups") or {}).get("alignmentGroupCount") if isinstance(sync_report, dict) else None,
        "alignmentBoundariesFromRawSpeechGaps": (sync_report.get("alignmentGroups") or {}).get("boundariesFromRawSpeechGaps") if isinstance(sync_report, dict) else None,
        "pauseDetectionProvider": vad_report.get("pauseDetectionProvider") or vad_report.get("provider"),
        "pauseDetectionDegraded": bool(vad_report.get("pauseDetectionDegraded")),
        "resolvedConfigSources": resolved_config_sources,
    }

    failures: list[tuple[str, str]] = []
    if getattr(pipeline_config.vad, "sileroEnabled", False):
        if final_report["pauseDetectionProvider"] != "silero":
            failures.append(("pause_detector_not_silero", "Silero VAD is enabled, but the job did not use Silero pause detection."))
        if final_report["pauseDetectionDegraded"]:
            failures.append(("pause_detection_degraded", "Silero VAD is enabled, but pause detection degraded to a fallback."))
    if not getattr(pipeline_config.alignment, "allowStableTsOrderFallback", False) and stable_order_count:
        failures.append(("stable_ts_order_fallback_disabled", "Stable-ts order fallback is disabled, but order-adjusted words were produced."))
    if not getattr(pipeline_config.quality, "allowEstimatedWords", False) and estimated_count:
        failures.append(("estimated_words_disabled", "Estimated timing words were produced while estimated words are disabled."))
    maximum_estimated_ratio = float(getattr(pipeline_config.quality, "maximumEstimatedWordRatio", 0.0))
    if estimated_ratio > maximum_estimated_ratio + 1e-9:
        failures.append(
            (
                "estimated_word_ratio_exceeded",
                f"Estimated word timing ratio {estimated_ratio:.1%} exceeds configured maximum {maximum_estimated_ratio:.0%}.",
            )
        )
    if invalid_ranges:
        failures.append(("invalid_word_ranges", f"{invalid_ranges} word(s) have invalid timestamp ranges."))
    if overlap_count:
        failures.append(("final_word_overlap", f"{overlap_count} final word overlap(s) remain."))
    if outside_group_count:
        failures.append(("word_outside_alignment_group", f"{outside_group_count} word timing boundary violation(s) remain."))
    if caption_cross_boundary_count:
        failures.append(("caption_crosses_hard_boundary", f"{caption_cross_boundary_count} caption group(s) cross a hard boundary."))

    final_report["passed"] = not failures
    final_report["failures"] = [{"category": category, "message": message} for category, message in failures]
    if failures:
        category, message = failures[0]
        logger.error("final_timing_quality_failed report=%s", final_report)
        raise TimingQualityError(category, message, final_report)
    logger.info("final_timing_quality_passed report=%s", final_report)
    return final_report
