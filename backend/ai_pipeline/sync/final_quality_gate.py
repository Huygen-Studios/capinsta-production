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


def _token_identity(word: dict[str, Any]) -> str | None:
    if word.get("providerTokenId") is not None:
        return str(word.get("providerTokenId"))
    token_index = word.get("sourceWordIndex", word.get("originalTokenIndex"))
    if token_index is None:
        return None
    group_id = word.get("alignmentGroupId", "ungrouped")
    segment_index = word.get("sourceSegmentIndex", "segment")
    return (
        f"{group_id}:"
        f"{segment_index}:"
        f"{token_index}"
    )


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
    deterministic_fallback_count = 0
    stable_order_count = 0
    invalid_ranges = 0
    overlap_count = 0
    outside_group_count = 0
    caption_cross_boundary_count = 0
    suspected_script_mismatch_count = 0
    duplicate_token_count = 0
    seen_token_identities: set[str] = set()
    prev_end: float | None = None
    prev_word: dict[str, Any] | None = None
    overlap_samples: list[dict[str, Any]] = []
    duplicate_token_samples: list[dict[str, Any]] = []

    for word in words:
        source = _word_source(word)
        source_counts[source] += 1
        if source in PRODUCTION_INVALID_TIMING_SOURCES:
            estimated_count += 1
        if source == "deterministic_fallback":
            deterministic_fallback_count += 1
        if _is_order_adjusted(word):
            stable_order_count += 1
        if word.get("suspectedScriptMismatch"):
            suspected_script_mismatch_count += 1
        token_identity = _token_identity(word)
        if token_identity is not None:
            if token_identity in seen_token_identities:
                duplicate_token_count += 1
                if len(duplicate_token_samples) < 10:
                    duplicate_token_samples.append(
                        {
                            "token": token_identity,
                            "word": str(word.get("displayedWord") or word.get("word") or word.get("spokenWord") or ""),
                            "start": _finite(word.get("start")),
                            "end": _finite(word.get("end")),
                            "alignmentGroupId": word.get("alignmentGroupId"),
                        }
                    )
            seen_token_identities.add(token_identity)
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
            if prev_word is not None and len(overlap_samples) < 10:
                overlap_samples.append(
                    {
                        "previousWord": str(prev_word.get("displayedWord") or prev_word.get("word") or prev_word.get("spokenWord") or ""),
                        "previousStart": _finite(prev_word.get("start")),
                        "previousEnd": _finite(prev_word.get("end")),
                        "previousTimingSource": str(prev_word.get("timingSourceDetail") or prev_word.get("timingSource") or prev_word.get("timing_source") or ""),
                        "word": str(word.get("displayedWord") or word.get("word") or word.get("spokenWord") or ""),
                        "start": start,
                        "end": end,
                        "timingSource": str(word.get("timingSourceDetail") or word.get("timingSource") or word.get("timing_source") or ""),
                        "alignmentGroupId": word.get("alignmentGroupId"),
                        "overlapSeconds": round(prev_end - start, 3),
                    }
                )
        prev_end = max(prev_end or 0.0, end)
        prev_word = word

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
    deterministic_fallback_ratio = deterministic_fallback_count / max(1, total)
    real_timed_word_count = max(0, total - estimated_count)
    real_timed_word_coverage = real_timed_word_count / max(1, total)
    stable_ts = sync_report.get("stableTs") if isinstance(sync_report, dict) else {}
    stable_timestamp_word_count = int(
        sum(count for source, count in source_counts.items() if source.startswith("stable_ts"))
    )
    whisperx_aligned_word_count = int(
        sum(count for source, count in source_counts.items() if source.startswith("whisperx"))
    )
    provider_native_word_count = int(
        sum(count for source, count in source_counts.items() if source.startswith("provider"))
    )
    aligned_word_count = stable_timestamp_word_count + whisperx_aligned_word_count
    aligned_word_coverage = aligned_word_count / max(1, total)
    stable_timestamp_coverage = stable_timestamp_word_count / max(1, total)
    if total == 0:
        timing_quality = "native"
    elif estimated_count >= total:
        timing_quality = "degraded"
    elif estimated_count:
        timing_quality = "mixed"
    elif aligned_word_count:
        timing_quality = "aligned"
    else:
        timing_quality = "native"
    fallback_reasons: list[str] = []
    if deterministic_fallback_count:
        fallback_reasons.append("deterministic_fallback")
    if estimated_count and estimated_count != deterministic_fallback_count:
        fallback_reasons.append("estimated_timing")
    final_report = {
        "totalWords": total,
        "timingSourceCounts": dict(source_counts),
        "estimatedWordCount": estimated_count,
        "estimatedWordRatio": round(estimated_ratio, 4),
        "deterministicFallbackWordCount": deterministic_fallback_count,
        "deterministicFallbackRatio": round(deterministic_fallback_ratio, 4),
        "providerNativeWordCount": provider_native_word_count,
        "stableTimestampWordCount": stable_timestamp_word_count,
        "whisperxAlignedWordCount": whisperx_aligned_word_count,
        "realTimedWordCount": real_timed_word_count,
        "realTimedWordCoverage": round(real_timed_word_coverage, 4),
        "alignmentAttempted": bool((stable_ts or {}).get("enabled") or (stable_ts or {}).get("available")),
        "alignmentApplied": aligned_word_count > 0,
        "alignmentPartiallyApplied": 0 < aligned_word_count < total,
        "alignmentCoverage": round(aligned_word_coverage, 4),
        "stableTimestampCoverage": round(stable_timestamp_coverage, 4),
        "timingQuality": timing_quality,
        "reviewRequired": timing_quality in {"mixed", "degraded"},
        "fallbackReasons": fallback_reasons,
        "stableTsOrderAdjustedCount": stable_order_count,
        "stableTsOrderFallbackEnabled": bool(getattr(pipeline_config.alignment, "allowStableTsOrderFallback", False)),
        "stableTsOrderFallbackAppliedWords": int((stable_ts or {}).get("orderFallbackAppliedWords") or 0),
        "invalidRangeCount": invalid_ranges,
        "overlapCount": overlap_count,
        "overlapSamples": overlap_samples,
        "outsideAlignmentGroupWindowCount": outside_group_count,
        "captionCrossBoundaryCount": caption_cross_boundary_count,
        "duplicateTokenCount": duplicate_token_count,
        "duplicateTokenSamples": duplicate_token_samples,
        "suspectedScriptMismatchCount": suspected_script_mismatch_count,
        "alignmentGroupCount": (sync_report.get("alignmentGroups") or {}).get("alignmentGroupCount") if isinstance(sync_report, dict) else None,
        "alignmentBoundariesFromRawSpeechGaps": (sync_report.get("alignmentGroups") or {}).get("boundariesFromRawSpeechGaps") if isinstance(sync_report, dict) else None,
        "pauseDetectionProvider": vad_report.get("pauseDetectionProvider") or vad_report.get("provider"),
        "pauseDetectionDegraded": bool(vad_report.get("pauseDetectionDegraded")),
        "resolvedConfigSources": resolved_config_sources,
    }

    failures: list[tuple[str, str]] = []
    max_estimated_ratio = getattr(pipeline_config.quality, "maximumEstimatedWordRatio", None)
    if total and max_estimated_ratio is not None and estimated_ratio > float(max_estimated_ratio):
        failures.append((
            "estimated_word_ratio_exceeded",
            f"{estimated_count} of {total} word(s) use estimated timing ({estimated_ratio:.2%}); maximum is {float(max_estimated_ratio):.2%}.",
        ))
    if total and estimated_count and getattr(pipeline_config.quality, "allowEstimatedWords", True) is False:
        failures.append((
            "estimated_words_disabled",
            f"{estimated_count} of {total} word(s) use estimated timing, but the selected preset disallows estimated words.",
        ))
    if getattr(pipeline_config.vad, "sileroEnabled", False):
        if final_report["pauseDetectionProvider"] != "silero":
            failures.append(("pause_detector_not_silero", "Silero VAD is enabled, but the job did not use Silero pause detection."))
        if final_report["pauseDetectionDegraded"]:
            failures.append(("pause_detection_degraded", "Silero VAD is enabled, but pause detection degraded to a fallback."))
    if not getattr(pipeline_config.alignment, "allowStableTsOrderFallback", False) and stable_order_count:
        failures.append(("stable_ts_order_fallback_disabled", "Stable-ts order fallback is disabled, but order-adjusted words were produced."))
    if invalid_ranges:
        failures.append(("invalid_word_ranges", f"{invalid_ranges} word(s) have invalid timestamp ranges."))
    if overlap_count:
        failures.append(("final_word_overlap", f"{overlap_count} final word overlap(s) remain."))
    if outside_group_count:
        failures.append(("word_outside_alignment_group", f"{outside_group_count} word timing boundary violation(s) remain."))
    if caption_cross_boundary_count:
        failures.append(("caption_crosses_hard_boundary", f"{caption_cross_boundary_count} caption group(s) cross a hard boundary."))
    if duplicate_token_count:
        failures.append(("duplicate_token_occurrence", f"{duplicate_token_count} duplicated token occurrence(s) remain in final words."))
    if suspected_script_mismatch_count:
        failures.append(("suspected_script_mismatch", f"{suspected_script_mismatch_count} unsupported script token(s) remain in final captions."))

    final_report["passed"] = not failures
    final_report["failures"] = [{"category": category, "message": message} for category, message in failures]
    if failures:
        final_report["timingQuality"] = "degraded"
    final_report["reviewRequired"] = bool(failures) or final_report["reviewRequired"]
    if failures:
        category, message = failures[0]
        logger.error("final_timing_quality_failed report=%s", final_report)
        raise TimingQualityError(category, message, final_report)
    logger.info("final_timing_quality_passed report=%s", final_report)
    return final_report
