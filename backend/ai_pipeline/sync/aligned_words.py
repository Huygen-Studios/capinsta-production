from __future__ import annotations

import logging
import math
from typing import Any

from ai_pipeline.renderer import chunk_words_into_captions


logger = logging.getLogger(__name__)
BAD_TIMING_MARKERS = ("estimated", "interpolated", "synthetic", "fallback", "low_confidence")
MIN_REPAIRED_WORD_DURATION_SECONDS = 0.04


def is_estimated_timing(word: dict[str, Any]) -> bool:
    source = " ".join(
        str(word.get(key) or "")
        for key in ("timingSourceCategory", "timing_source", "timingSource", "timingSourceDetail")
    ).lower()
    return any(marker in source for marker in BAD_TIMING_MARKERS)


def canonical_aligned_words_from_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for segment in segments:
        for raw_word in segment.get("words") or []:
            word = dict(raw_word)
            display_word = str(word.get("displayedWord") or word.get("word") or "").strip()
            spoken_word = str(word.get("spokenWord") or word.get("originalWord") or word.get("word") or "").strip()
            if not display_word:
                continue
            word["displayedWord"] = display_word
            word["spokenWord"] = spoken_word or display_word
            word["word"] = display_word
            if is_estimated_timing(word):
                word["timingNeedsReview"] = True
                word["timingReviewRequired"] = True
                word["timingWarning"] = word.get("timingWarning") or "Word timing is estimated; sync cannot be guaranteed. Use High Quality Alignment."
            words.append(word)
    words.sort(key=lambda item: (float(item.get("start") or 0), float(item.get("end") or 0)))
    return words


def _finite_time(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(value):
        return max(0.0, float(value))
    return None


def assign_alignment_groups_from_speech_gaps(
    segments: list[dict[str, Any]],
    hard_gaps: list[dict[str, Any]],
    *,
    pause_threshold: float,
    tolerance_seconds: float = 0.03,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Assign language-neutral hard alignment groups from speech-pause gaps.

    The group boundary is structural: provider/source segment changes, explicit
    speaker/turn changes, and raw VAD no-speech gaps. The text content is never
    inspected, so the same protection applies to every language mode.
    """
    valid_gaps: list[tuple[float, float]] = []
    for gap in hard_gaps or []:
        if not isinstance(gap, dict):
            continue
        start = _finite_time(gap.get("start"))
        end = _finite_time(gap.get("end"))
        if start is None or end is None or end <= start:
            continue
        if end - start + 1e-6 >= max(0.0, pause_threshold):
            valid_gaps.append((start, end))
    valid_gaps.sort()

    words: list[tuple[int, int, dict[str, Any]]] = []
    for segment_index, segment in enumerate(segments):
        for word_index, word in enumerate(segment.get("words") or []):
            if isinstance(word, dict):
                words.append((segment_index, word_index, word))
    words.sort(key=lambda item: (_finite_time(item[2].get("start")) or 0.0, _finite_time(item[2].get("end")) or 0.0, item[0], item[1]))

    group_index = -1
    current_key: tuple[Any, Any, Any] | None = None
    current_group_id: str | None = None
    groups: dict[str, list[dict[str, Any]]] = {}
    previous_word: dict[str, Any] | None = None
    boundaries_from_gaps = 0

    def word_key(segment_index: int, word: dict[str, Any]) -> tuple[Any, Any, Any]:
        return (
            word.get("speakerId") or word.get("speaker_id"),
            word.get("turnId") or word.get("turn_id") or word.get("speakerTurnId"),
            word.get("sourceSegmentIndex", segment_index),
        )

    def has_gap_between(left_end: float | None, right_start: float | None) -> tuple[bool, tuple[float, float] | None]:
        if left_end is None or right_start is None:
            return False, None
        lo = min(left_end, right_start)
        hi = max(left_end, right_start)
        for gap_start, gap_end in valid_gaps:
            if gap_end < lo - tolerance_seconds:
                continue
            if gap_start > hi + tolerance_seconds:
                break
            if gap_end - gap_start + 1e-6 >= pause_threshold and gap_start >= left_end - tolerance_seconds and gap_end <= right_start + tolerance_seconds:
                return True, (gap_start, gap_end)
            if gap_start <= right_start <= gap_end or gap_start <= left_end <= gap_end:
                return True, (gap_start, gap_end)
        return False, None

    for segment_index, _word_index, word in words:
        start = _finite_time(word.get("start"))
        end = _finite_time(word.get("end"))
        key = word_key(segment_index, word)
        boundary_reason: str | None = None
        boundary_gap: tuple[float, float] | None = None
        if current_key is None or key != current_key:
            boundary_reason = "source_or_turn_boundary"
        elif previous_word is not None:
            gap_break, gap = has_gap_between(_finite_time(previous_word.get("end")), start)
            if gap_break:
                boundary_reason = "raw_speech_gap"
                boundary_gap = gap
                boundaries_from_gaps += 1

        if boundary_reason:
            group_index += 1
            current_group_id = f"ag-{group_index:04d}"
            current_key = key
            if previous_word is not None:
                previous_word["hardBoundaryAfter"] = True
                previous_word["hardBoundaryReason"] = boundary_reason
            word["hardBoundaryBefore"] = True
            word["hardBoundaryReason"] = boundary_reason
            if boundary_gap:
                word["hardBoundaryGapStart"] = round(boundary_gap[0], 3)
                word["hardBoundaryGapEnd"] = round(boundary_gap[1], 3)

        if current_group_id is None:
            group_index += 1
            current_group_id = f"ag-{group_index:04d}"
            current_key = key

        word["alignmentGroupId"] = current_group_id
        word["sourceSegmentIndex"] = word.get("sourceSegmentIndex", segment_index)
        groups.setdefault(current_group_id, []).append(word)
        previous_word = word

    for group_id, group_words in groups.items():
        starts = [_finite_time(word.get("start")) for word in group_words]
        ends = [_finite_time(word.get("end")) for word in group_words]
        group_start = min(value for value in starts if value is not None)
        group_end = max(value for value in ends if value is not None)
        for gap_start, gap_end in valid_gaps:
            if gap_end <= group_start + tolerance_seconds:
                group_start = max(group_start, gap_end)
            if gap_start >= group_end - tolerance_seconds:
                group_end = min(group_end, gap_start)
                break
        if group_end <= group_start:
            group_end = max(group_start + MIN_REPAIRED_WORD_DURATION_SECONDS, max(value for value in ends if value is not None))
        for word in group_words:
            word["sourceStart"] = round(group_start, 3)
            word["sourceEnd"] = round(group_end, 3)
            word["alignmentGroupSource"] = word.get("alignmentGroupSource") or "raw_speech_vad"

    for segment_index, segment in enumerate(segments):
        segment_words = [word for word in segment.get("words") or [] if isinstance(word, dict)]
        if not segment_words:
            continue
        group_ids = {str(word.get("alignmentGroupId")) for word in segment_words if word.get("alignmentGroupId")}
        if len(group_ids) == 1:
            group_id = next(iter(group_ids))
            segment["alignmentGroupId"] = group_id
            segment["sourceStart"] = segment_words[0].get("sourceStart")
            segment["sourceEnd"] = segment_words[-1].get("sourceEnd")
        segment["sourceSegmentIndex"] = segment.get("sourceSegmentIndex", segment_index)

    return segments, {
        "alignmentGroupCount": len(groups),
        "hardSpeechGapCount": len(valid_gaps),
        "boundariesFromRawSpeechGaps": boundaries_from_gaps,
    }


def sanitize_aligned_word_ranges(
    segments: list[dict[str, Any]],
    *,
    min_duration: float = MIN_REPAIRED_WORD_DURATION_SECONDS,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Ensure word and segment ranges are valid before building transcript clips.

    Stable-ts occasionally returns a reversed or zero-length word boundary when
    nearby repeated/short words are hard to align. The editor correctly rejects
    those ranges, so repair the minimal local boundary here and mark the word
    for review instead of letting one bad token poison the whole caption job.
    """
    repaired_words = 0
    dropped_words = 0
    previous_end_by_group: dict[str, float] = {}

    for segment in segments:
        repaired_segment_words: list[dict[str, Any]] = []
        for raw_word in segment.get("words") or []:
            if not isinstance(raw_word, dict):
                dropped_words += 1
                continue
            text = str(
                raw_word.get("displayedWord")
                or raw_word.get("word")
                or raw_word.get("spokenWord")
                or ""
            ).strip()
            if not text:
                dropped_words += 1
                continue
            start = _finite_time(raw_word.get("start"))
            end = _finite_time(raw_word.get("end"))
            if start is None and end is None:
                dropped_words += 1
                continue
            original_start = start
            original_end = end
            group_id = str(raw_word.get("alignmentGroupId") or segment.get("alignmentGroupId") or f"segment:{len(previous_end_by_group)}")
            group_start = _finite_time(raw_word.get("sourceStart") if "sourceStart" in raw_word else segment.get("sourceStart"))
            group_end = _finite_time(raw_word.get("sourceEnd") if "sourceEnd" in raw_word else segment.get("sourceEnd"))
            previous_end = previous_end_by_group.get(group_id, max(0.0, group_start or 0.0))
            if start is None:
                start = max(0.0, (end or previous_end) - min_duration)
            if end is None:
                end = start + min_duration
            duration = max(min_duration, end - start)
            if group_start is not None and start < group_start:
                start = group_start
            if group_end is not None and start >= group_end:
                start = max(group_start or 0.0, group_end - min_duration)
                end = group_end
            if end <= start:
                end = start + duration
            if start < previous_end and end <= previous_end:
                start = previous_end
                end = start + duration
            elif start < previous_end:
                start = previous_end
                if end <= start:
                    end = start + duration
            start = round(start, 3)
            end = round(max(end, start + min_duration), 3)
            if group_end is not None and end > group_end:
                end = round(group_end, 3)
                if end <= start:
                    start = round(max(group_start or 0.0, end - min_duration), 3)
            if original_start != start or original_end != end:
                raw_word["timingNeedsReview"] = True
                raw_word["timingReviewRequired"] = True
                raw_word["timingWarning"] = raw_word.get("timingWarning") or "Word timing range was repaired after alignment returned an invalid boundary."
                raw_word["timingRepairReason"] = "invalid_or_overlapping_word_range"
                raw_word["timingRepairOriginalStart"] = original_start
                raw_word["timingRepairOriginalEnd"] = original_end
                repaired_words += 1
            raw_word["start"] = start
            raw_word["end"] = end
            previous_end_by_group[group_id] = end
            repaired_segment_words.append(raw_word)

        segment["words"] = repaired_segment_words
        if repaired_segment_words:
            segment["start"] = round(float(repaired_segment_words[0]["start"]), 3)
            segment["end"] = round(float(repaired_segment_words[-1]["end"]), 3)
            segment["text"] = " ".join(str(word.get("displayedWord") or word.get("word") or "").strip() for word in repaired_segment_words).strip() or segment.get("text", "")

    report = {"repairedWords": repaired_words, "droppedWords": dropped_words}
    if repaired_words or dropped_words:
        logger.warning("aligned_word_range_sanitized report=%s", report)
    return segments, report


def build_segments_from_aligned_words(
    aligned_words: list[dict[str, Any]],
    *,
    chunking_rules: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    captions = chunk_words_into_captions(aligned_words, chunking_rules)
    segments: list[dict[str, Any]] = []
    for index, caption in enumerate(captions):
        words = [dict(word) for word in caption.get("words") or []]
        if not words:
            continue
        needs_review = any(is_estimated_timing(word) or word.get("timingNeedsReview") for word in words)
        segments.append(
            {
                "id": f"cap_{index + 1:04d}",
                "start": caption["start"],
                "end": caption["end"],
                "text": caption["text"],
                "words": words,
                "timingBasis": "alignedWords",
                "timingNeedsReview": needs_review or None,
                "timingWarning": "Word timing is estimated; sync cannot be guaranteed. Use High Quality Alignment." if needs_review else None,
            }
        )
    return segments


def aligned_word_quality(segments: list[dict[str, Any]]) -> dict[str, Any]:
    words = canonical_aligned_words_from_segments(segments)
    estimated = sum(1 for word in words if is_estimated_timing(word))
    review = sum(1 for word in words if word.get("timingNeedsReview") or word.get("timingReviewRequired"))
    total = len(words)
    return {
        "totalWords": total,
        "estimatedWordCount": estimated,
        "estimatedWordRatio": round(estimated / max(1, total), 4),
        "timingNeedsReviewCount": review,
    }
