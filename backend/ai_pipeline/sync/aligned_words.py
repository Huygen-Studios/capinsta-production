from __future__ import annotations

from typing import Any

from ai_pipeline.renderer import chunk_words_into_captions


BAD_TIMING_MARKERS = ("estimated", "interpolated", "synthetic", "fallback", "low_confidence")


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
