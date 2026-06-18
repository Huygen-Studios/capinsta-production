from __future__ import annotations

import logging
import math
from typing import Any

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
    word["timing_source"] = "pause_preserved"
    word["timingSource"] = "pause_preserved"
    word["timingSourceDetail"] = " | ".join(details)


def preserve_detected_pauses(
    segments: list[dict[str, Any]],
    silence_gaps: list[dict[str, Any]],
    pause_threshold: float,
    *,
    diagnostics: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """Make the canonical word timeline respect detected audio silence.

    Provider/estimated word timings sometimes compress a spoken pause into a
    few milliseconds. For each qualifying silence interval this pass:

    * clamps words that cross the start of silence;
    * moves the first word placed inside silence to the end of silence; and
    * shifts only following overlapping words, preserving order and duration.

    The input segments are intentionally mutated because the surrounding
    pipeline already treats timing optimization passes as in-place transforms.
    """
    stats = {
        "pauseGapsApplied": 0,
        "pauseGapsAlreadyPreserved": 0,
        "wordsShiftedForPause": 0,
        "wordsClampedForPause": 0,
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
            if word_start < gap_start < word_end:
                word["end"] = round(gap_start, 3)
                word["pausePreservedOriginalEnd"] = round(word_end, 3)
                _mark_pause_preserved(word)
                stats["wordsClampedForPause"] += 1
                gap_changed = True

        first_inside_index = next(
            (
                index
                for index, word in enumerate(words)
                if gap_start <= float(word["start"]) < gap_end
            ),
            None,
        )
        if first_inside_index is not None:
            previous_adjusted_end: float | None = None
            for index in range(first_inside_index, len(words)):
                word = words[index]
                original_start = float(word["start"])
                original_end = float(word["end"])
                target_start = gap_end if index == first_inside_index else previous_adjusted_end
                if target_start is None or original_start >= target_start - 1e-6:
                    break

                duration = max(0.001, original_end - original_start)
                word["start"] = round(target_start, 3)
                word["end"] = round(target_start + duration, 3)
                word["pausePreservedOriginalStart"] = round(original_start, 3)
                word["pausePreservedShiftSeconds"] = round(target_start - original_start, 3)
                _mark_pause_preserved(word)
                previous_adjusted_end = float(word["end"])
                stats["wordsShiftedForPause"] += 1
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
