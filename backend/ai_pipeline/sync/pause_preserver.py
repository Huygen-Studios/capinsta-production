from __future__ import annotations

import logging
import math
from typing import Any

from .aligned_words import cap_same_group_word_overlaps

logger = logging.getLogger(__name__)


def _finite_time(value: Any) -> float | None:
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def _mark_pause_preserved(word: dict[str, Any]) -> None:
    previous_detail = str(
        word.get("timingSourceDetail")
        or word.get("timingSource")
        or word.get("timing_source")
        or ""
    ).strip()
    details = [part.strip() for part in previous_detail.split("|") if part.strip()]
    if "pause_preserved" not in details:
        details.append("pause_preserved")
    word["timing_source"] = "provider_native_unconfirmed"
    word["timingSource"] = "provider_native_unconfirmed"
    word["timingSourceDetail"] = " | ".join(details)
    word["timingNeedsReview"] = True
    word["timingReviewRequired"] = True
    word["timingRepairReason"] = "hard_speech_gap_boundary_repair"


def preserve_detected_pauses(
    segments: list[dict[str, Any]],
    silence_gaps: list[dict[str, Any]],
    pause_threshold: float,
    *,
    diagnostics: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """Make the canonical word timeline respect hard speech pauses locally.

    This function deliberately avoids global shifting. A bad refined timestamp
    near one pause must not steal visible duration from the following phrase or
    speaker turn.
    """
    stats = {
        "pauseGapsApplied": 0,
        "pauseGapsAlreadyPreserved": 0,
        "wordsShiftedForPause": 0,
        "wordsClampedForPause": 0,
        "wordsRejectedForCrossingHardGap": 0,
        "sameGroupOverlapCaps": 0,
    }
    if diagnostics is not None:
        diagnostics.update(stats)
    if not segments or not silence_gaps:
        return segments

    indexed_words: list[tuple[int, dict[str, Any]]] = []
    sequence = 0
    for segment in segments:
        for word in segment.get("words") or []:
            start = _finite_time(word.get("start")) if isinstance(word, dict) else None
            end = _finite_time(word.get("end")) if isinstance(word, dict) else None
            if start is None or end is None or end <= start:
                continue
            indexed_words.append((sequence, word))
            sequence += 1

    indexed_words.sort(
        key=lambda item: (
            float(item[1]["start"]),
            float(item[1]["end"]),
            item[0],
        )
    )
    words = [word for _, word in indexed_words]
    valid_gaps: list[tuple[float, float]] = []
    for gap in silence_gaps:
        start = _finite_time(gap.get("start")) if isinstance(gap, dict) else None
        end = _finite_time(gap.get("end")) if isinstance(gap, dict) else None
        if start is None or end is None or end <= start:
            continue
        duration = end - start
        if duration + 1e-6 >= max(0.0, pause_threshold):
            valid_gaps.append((start, end))
    valid_gaps.sort()

    for gap_start, gap_end in valid_gaps:
        gap_changed = False

        for word in words:
            word_start = float(word["start"])
            word_end = float(word["end"])
            if word_end <= gap_start + 1e-6 or word_start >= gap_end - 1e-6:
                continue
            original_start = word_start
            original_end = word_end
            native_start = _finite_time(word.get("nativeStart") or word.get("providerStart"))
            native_end = _finite_time(word.get("nativeEnd") or word.get("providerEnd"))
            if (
                native_start is not None
                and native_end is not None
                and native_end > native_start
                and not (native_start < gap_end and native_end > gap_start)
            ):
                word_start = native_start
                word_end = native_end
            else:
                midpoint = (word_start + word_end) / 2.0
                duration = max(0.04, word_end - word_start)
                if word_start >= gap_start:
                    word_start = max(word_start, gap_end)
                    word_end = max(word_end, word_start + duration)
                elif midpoint <= gap_start:
                    word_end = min(word_end, gap_start)
                    word_start = min(word_start, max(0.0, word_end - 0.04))
                elif midpoint >= gap_end:
                    word_start = max(word_start, gap_end)
                    word_end = max(word_end, word_start + duration)
                else:
                    group_start = _finite_time(word.get("sourceStart"))
                    group_end = _finite_time(word.get("sourceEnd"))
                    if group_end is not None and group_end <= gap_start + 1e-6:
                        word_end = min(group_end, gap_start)
                        word_start = max(group_start or 0.0, word_end - duration)
                    elif group_start is not None and group_start >= gap_end - 1e-6:
                        word_start = max(group_start, gap_end)
                        word_end = min(group_end or word_start + duration, word_start + duration)
                    else:
                        word_end = min(word_end, gap_start)
                        word_start = min(word_start, max(0.0, word_end - duration))

            if word_end <= word_start:
                if word_start < gap_start:
                    word_end = gap_start
                    word_start = max(0.0, word_end - 0.04)
                else:
                    word_start = gap_end
                    word_end = word_start + 0.04
            word["start"] = round(word_start, 3)
            word["end"] = round(word_end, 3)
            word["pausePreservedOriginalStart"] = round(original_start, 3)
            word["pausePreservedOriginalEnd"] = round(original_end, 3)
            if original_start != word["start"] or original_end != word["end"]:
                logger.info(
                    "timing_word_mutated stage=pause_preservation alignmentGroupId=%s word=%r originalStart=%.3f originalEnd=%.3f newStart=%.3f newEnd=%.3f reason=hard_speech_gap_boundary_repair sourceStart=%r sourceEnd=%r",
                    word.get("alignmentGroupId"),
                    word.get("displayedWord") or word.get("word") or word.get("spokenWord"),
                    original_start,
                    original_end,
                    word["start"],
                    word["end"],
                    word.get("sourceStart"),
                    word.get("sourceEnd"),
                )
                _mark_pause_preserved(word)
                stats["wordsClampedForPause"] += 1
                stats["wordsRejectedForCrossingHardGap"] += 1
                gap_changed = True

        gap_is_clear = not any(
            float(word["start"]) < gap_end - 1e-6
            and float(word["end"]) > gap_start + 1e-6
            for word in words
        )
        has_word_before = any(float(word["end"]) <= gap_start + 1e-6 for word in words)
        has_word_after = any(float(word["start"]) >= gap_end - 1e-6 for word in words)
        if gap_is_clear and has_word_before and has_word_after:
            stats["pauseGapsApplied"] += 1
            if not gap_changed:
                stats["pauseGapsAlreadyPreserved"] += 1

    overlap_diagnostics: dict[str, Any] = {}
    stats["sameGroupOverlapCaps"] = cap_same_group_word_overlaps(
        segments,
        diagnostics=overlap_diagnostics,
        stage="pause_preservation",
    )
    if overlap_diagnostics.get("timingMutationSamples") and diagnostics is not None:
        diagnostics["timingMutationSamples"] = overlap_diagnostics["timingMutationSamples"]

    for segment in segments:
        valid_words = [
            word
            for word in segment.get("words") or []
            if _finite_time(word.get("start")) is not None
            and _finite_time(word.get("end")) is not None
            and float(word["end"]) > float(word["start"])
        ]
        if valid_words:
            valid_words.sort(key=lambda word: (float(word["start"]), float(word["end"])))
            segment["start"] = round(float(valid_words[0]["start"]), 3)
            segment["end"] = round(float(valid_words[-1]["end"]), 3)

    if diagnostics is not None:
        diagnostics.update(stats)
    logger.info(
        "pause_preservation pauseGapsApplied=%d pauseGapsAlreadyPreserved=%d wordsShiftedForPause=%d wordsClampedForPause=%d",
        stats["pauseGapsApplied"],
        stats["pauseGapsAlreadyPreserved"],
        stats["wordsShiftedForPause"],
        stats["wordsClampedForPause"],
    )
    return segments
