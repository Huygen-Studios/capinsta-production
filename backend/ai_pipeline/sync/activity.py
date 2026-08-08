from __future__ import annotations

import math
from typing import Any

from ai_pipeline.timing import DEFAULT_PAUSE_SPLIT_THRESHOLD, detect_silence_gaps


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        numeric = float(value)
        return numeric if math.isfinite(numeric) else fallback
    except (TypeError, ValueError):
        return fallback


def _duration_from_segments(segments: list[dict[str, Any]]) -> float:
    return max([_safe_float(seg.get("end")) for seg in segments] + [0.0])


def _empty_activity(duration_seconds: float, frame_step: float) -> list[int]:
    frames = max(1, int(math.ceil(max(0.0, duration_seconds) / frame_step)) + 1)
    return [0] * frames


def _mark_range(activity: list[int], start: float, end: float, frame_step: float) -> None:
    if end <= start:
        return
    start_idx = max(0, int(math.floor(start / frame_step)))
    end_idx = min(len(activity), int(math.ceil(end / frame_step)))
    for idx in range(start_idx, end_idx):
        activity[idx] = 1


def build_caption_activity_from_segments(
    segments: list[dict[str, Any]],
    frame_step: float = 0.02,
    duration_seconds: float | None = None,
) -> list[int]:
    duration = duration_seconds or _duration_from_segments(segments)
    activity = _empty_activity(duration, frame_step)
    for segment in segments:
        words = segment.get("words") or []
        if words:
            for word in words:
                _mark_range(activity, _safe_float(word.get("start")), _safe_float(word.get("end")), frame_step)
        else:
            _mark_range(activity, _safe_float(segment.get("start")), _safe_float(segment.get("end")), frame_step)
    return activity


def extract_speech_segments(audio_path: str) -> dict[str, Any]:
    return detect_silence_gaps(audio_path, min_silence=DEFAULT_PAUSE_SPLIT_THRESHOLD)


def build_speech_activity_from_vad(
    audio_path: str,
    frame_step: float = 0.02,
    min_silence: float | None = None,
) -> dict[str, Any]:
    vad = detect_silence_gaps(audio_path, min_silence=min_silence)
    duration = _safe_float(vad.get("audioDuration"), 0.0)
    ranges = vad.get("speechSegments") if isinstance(vad.get("speechSegments"), list) else []
    activity = _empty_activity(duration, frame_step)
    for item in ranges:
        if isinstance(item, dict):
            _mark_range(activity, _safe_float(item.get("start")), _safe_float(item.get("end")), frame_step)
    return {"activity": activity, "speechRanges": ranges, "vad": vad}


def activity_to_ranges(activity: list[int], frame_step: float) -> list[dict[str, float]]:
    ranges: list[dict[str, float]] = []
    start_idx: int | None = None
    for idx, active in enumerate(activity + [0]):
        if active and start_idx is None:
            start_idx = idx
        elif not active and start_idx is not None:
            ranges.append({"start": round(start_idx * frame_step, 3), "end": round(idx * frame_step, 3)})
            start_idx = None
    return ranges


def compute_activity_overlap_score(caption_activity: list[int], speech_activity: list[int]) -> float:
    n = max(len(caption_activity), len(speech_activity))
    if n <= 0:
        return 0.0
    cap = caption_activity + [0] * (n - len(caption_activity))
    speech = speech_activity + [0] * (n - len(speech_activity))
    intersection = sum(1 for a, b in zip(cap, speech) if a and b)
    union = sum(1 for a, b in zip(cap, speech) if a or b)
    if union == 0:
        return 0.0
    return intersection / union
