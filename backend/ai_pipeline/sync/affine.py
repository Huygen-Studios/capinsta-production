from __future__ import annotations

import copy
import math
from typing import Any

from .report import SyncPassResult


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        numeric = float(value)
        return numeric if math.isfinite(numeric) else fallback
    except (TypeError, ValueError):
        return fallback


def _round_time(value: float) -> float:
    return round(max(0.0, float(value)), 3)


def apply_affine_time(t: float, shift_seconds: float = 0.0, skew: float = 1.0, anchor_seconds: float = 0.0) -> float:
    """Apply native subsync-style retiming: anchor + ((t - anchor) * skew) + shift."""
    return _round_time(anchor_seconds + ((_safe_float(t) - anchor_seconds) * skew) + shift_seconds)


def retime_word(
    word: dict[str, Any],
    shift_seconds: float,
    skew: float,
    anchor_seconds: float,
    min_word_duration: float = 0.04,
) -> dict[str, Any]:
    next_word = dict(word)
    start = apply_affine_time(_safe_float(word.get("start")), shift_seconds, skew, anchor_seconds)
    end = apply_affine_time(_safe_float(word.get("end"), start + min_word_duration), shift_seconds, skew, anchor_seconds)
    if end < start:
        start, end = end, start
    if end - start < min_word_duration:
        end = _round_time(start + min_word_duration)
    next_word["start"] = start
    next_word["end"] = end
    return next_word


def _segment_in_range(segment: dict[str, Any], start_range: float | None, end_range: float | None) -> bool:
    start = _safe_float(segment.get("start"))
    end = _safe_float(segment.get("end"), start)
    if start_range is not None and end < start_range:
        return False
    if end_range is not None and start > end_range:
        return False
    return True


def validate_monotonic_word_timing(segments: list[dict[str, Any]]) -> dict[str, Any]:
    warnings: list[str] = []
    repairs = 0
    prev_word: dict[str, Any] | None = None
    prev_segment: dict[str, Any] | None = None

    for seg_index, segment in enumerate(segments):
        words = segment.get("words") or []
        for word_index, word in enumerate(words):
            start = _safe_float(word.get("start"))
            end = _safe_float(word.get("end"), start + 0.04)
            if end <= start:
                end = _round_time(start + 0.04)
                word["end"] = end
                repairs += 1
                warnings.append(f"word[{seg_index}:{word_index}] duration repaired")
            if prev_word is not None:
                prev_end = _safe_float(prev_word.get("end"))
                if start < prev_end:
                    if prev_end - start <= 0.12:
                        prev_word["end"] = _round_time(start)
                        repairs += 1
                    else:
                        word["start"] = _round_time(prev_end)
                        word["end"] = max(_round_time(prev_end + 0.04), _safe_float(word.get("end"), prev_end + 0.04))
                        repairs += 1
                    warnings.append(f"word[{seg_index}:{word_index}] overlap repaired")
            prev_word = word

        if words:
            segment["start"] = _round_time(min(_safe_float(w.get("start")) for w in words))
            segment["end"] = _round_time(max(_safe_float(w.get("end"), _safe_float(w.get("start"))) for w in words))
        else:
            start = _safe_float(segment.get("start"))
            end = max(start + 0.04, _safe_float(segment.get("end"), start + 0.04))
            segment["start"] = _round_time(start)
            segment["end"] = _round_time(end)

        if prev_segment is not None and _safe_float(segment.get("start")) < _safe_float(prev_segment.get("end")):
            segment["start"] = _round_time(_safe_float(prev_segment.get("end")))
            if _safe_float(segment.get("end")) <= _safe_float(segment.get("start")):
                segment["end"] = _round_time(_safe_float(segment.get("start")) + 0.04)
            repairs += 1
        prev_segment = segment

    return {"valid": not warnings, "repairs": repairs, "warnings": warnings[:100]}


def clamp_segments_to_duration(segments: list[dict[str, Any]], duration_seconds: float | None = None) -> SyncPassResult:
    warnings: list[str] = []
    duration = _safe_float(duration_seconds, 0.0) if duration_seconds is not None else None
    next_segments = copy.deepcopy(segments)
    for segment in next_segments:
        segment["start"] = _round_time(segment.get("start", 0))
        segment["end"] = _round_time(segment.get("end", segment["start"] + 0.04))
        if duration and segment["start"] > duration:
            warnings.append("segment starts after media duration")
            segment["start"] = _round_time(duration)
        if duration and segment["end"] > duration:
            segment["end"] = _round_time(duration)
        if segment["end"] <= segment["start"]:
            segment["end"] = _round_time(segment["start"] + 0.04)
        for word in segment.get("words") or []:
            word["start"] = _round_time(word.get("start", segment["start"]))
            word["end"] = _round_time(word.get("end", word["start"] + 0.04))
            if duration and word["start"] > duration:
                word["start"] = _round_time(duration)
            if duration and word["end"] > duration:
                word["end"] = _round_time(duration)
            if word["end"] <= word["start"]:
                word["end"] = _round_time(word["start"] + 0.04)
    validation = validate_monotonic_word_timing(next_segments)
    warnings.extend(validation.get("warnings") or [])
    return SyncPassResult(next_segments, {"applied": True, "warnings": warnings[:100], "validation": validation})


def retime_segments(
    segments: list[dict[str, Any]],
    shift_seconds: float = 0.0,
    skew: float = 1.0,
    anchor_seconds: float = 0.0,
    start_range: float | None = None,
    end_range: float | None = None,
) -> SyncPassResult:
    next_segments = copy.deepcopy(segments)
    changed = 0
    warnings: list[str] = []

    if skew <= 0 or not math.isfinite(skew):
        skew = 1.0
        warnings.append("invalid skew reset to 1.0")

    for segment in next_segments:
        if not _segment_in_range(segment, start_range, end_range):
            continue
        changed += 1
        old_start = _safe_float(segment.get("start"))
        old_end = _safe_float(segment.get("end"), old_start + 0.04)
        segment["start"] = apply_affine_time(old_start, shift_seconds, skew, anchor_seconds)
        segment["end"] = apply_affine_time(old_end, shift_seconds, skew, anchor_seconds)
        if segment["end"] <= segment["start"]:
            segment["end"] = _round_time(segment["start"] + 0.04)
        for word in segment.get("words") or []:
            word.update(retime_word(word, shift_seconds, skew, anchor_seconds))
            word["timingSource"] = "manual_global_sync"
            word["timing_source"] = "manual_global_sync"
            word["timingSourceDetail"] = "manual_global_sync"

    validation = validate_monotonic_word_timing(next_segments)
    warnings.extend(validation.get("warnings") or [])
    return SyncPassResult(
        next_segments,
        {
            "applied": True,
            "shiftSeconds": round(float(shift_seconds), 4),
            "skew": round(float(skew), 6),
            "anchorSeconds": round(float(anchor_seconds), 4),
            "startRange": start_range,
            "endRange": end_range,
            "changedSegments": changed,
            "warnings": warnings[:100],
            "validation": validation,
        },
    )
