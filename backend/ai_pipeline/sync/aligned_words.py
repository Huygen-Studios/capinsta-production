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
    previous_end = 0.0

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
            if start is None:
                start = max(0.0, (end or previous_end) - min_duration)
            if end is None:
                end = start + min_duration
            duration = max(min_duration, end - start)
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
            previous_end = end
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
