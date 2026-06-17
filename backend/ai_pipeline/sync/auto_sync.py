from __future__ import annotations

import copy
import math
import os
from typing import Any

from .activity import (
    activity_to_ranges,
    build_caption_activity_from_segments,
    build_speech_activity_from_vad,
    compute_activity_overlap_score,
)
from .affine import retime_segments
from .report import SyncPassResult, SyncReport


DEFAULT_SKEW_CANDIDATES = [
    1.0,
    23.976 / 24,
    24 / 23.976,
    24 / 25,
    25 / 24,
    23.976 / 25,
    25 / 23.976,
    0.995,
    0.9975,
    1.0025,
    1.005,
]


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on", "enabled"}


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)) or default)
    except (TypeError, ValueError):
        return default


def _shift_activity(activity: list[int], shift_seconds: float, frame_step: float, length: int) -> list[int]:
    shift_frames = int(round(shift_seconds / frame_step))
    shifted = [0] * length
    for idx, active in enumerate(activity):
        if not active:
            continue
        next_idx = idx + shift_frames
        if 0 <= next_idx < length:
            shifted[next_idx] = 1
    return shifted


def _segment_duration(segments: list[dict[str, Any]], fallback: float | None = None) -> float:
    ends = [float(seg.get("end") or 0) for seg in segments if isinstance(seg.get("end"), (int, float))]
    return max(ends + [float(fallback or 0), 0.0])


def _estimated_word_ratio(segments: list[dict[str, Any]]) -> float:
    total = 0
    estimated = 0
    for segment in segments:
        for word in segment.get("words") or []:
            total += 1
            source = f"{word.get('timingSourceCategory') or ''} {word.get('timing_source') or ''} {word.get('timingSource') or ''}".lower()
            if any(marker in source for marker in ("estimated", "synthetic", "fallback", "interpolated")):
                estimated += 1
    return estimated / max(1, total)


def _retimed_activity(
    segments: list[dict[str, Any]],
    skew: float,
    duration_seconds: float,
    frame_step: float,
) -> list[int]:
    if abs(skew - 1.0) < 1e-9:
        return build_caption_activity_from_segments(segments, frame_step, duration_seconds)
    retimed = retime_segments(segments, shift_seconds=0.0, skew=skew, anchor_seconds=0.0).segments
    return build_caption_activity_from_segments(retimed, frame_step, duration_seconds)


def estimate_global_shift(
    caption_activity: list[int],
    speech_activity: list[int],
    frame_step: float = 0.02,
    max_shift_seconds: float = 2.0,
) -> dict[str, Any]:
    length = max(len(caption_activity), len(speech_activity))
    baseline = compute_activity_overlap_score(caption_activity, speech_activity)
    max_frames = max(0, int(round(max_shift_seconds / frame_step)))
    best_shift = 0.0
    best_score = baseline
    scores: list[dict[str, float]] = []
    for shift_frames in range(-max_frames, max_frames + 1):
        shift = shift_frames * frame_step
        shifted = _shift_activity(caption_activity, shift, frame_step, length)
        score = compute_activity_overlap_score(shifted, speech_activity)
        scores.append({"shiftSeconds": round(shift, 3), "score": round(score, 5)})
        if score > best_score:
            best_score = score
            best_shift = shift
    return {
        "shiftSeconds": round(best_shift, 3),
        "baselineScore": round(baseline, 5),
        "bestScore": round(best_score, 5),
        "improvement": round(best_score - baseline, 5),
        "scores": scores,
    }


def estimate_global_shift_and_skew(
    segments: list[dict[str, Any]],
    audio_path: str,
    duration_seconds: float | None = None,
    max_shift_seconds: float = 2.0,
    skew_candidates: list[float] | None = None,
) -> SyncPassResult:
    frame_step = max(0.005, _float_env("AUTO_SYNC_FRAME_STEP_SECONDS", 0.02))
    duration = max(_segment_duration(segments, duration_seconds), float(duration_seconds or 0))
    speech = build_speech_activity_from_vad(audio_path, frame_step=frame_step)
    speech_activity = speech["activity"]
    if len(speech_activity) > int(math.ceil(duration / frame_step)) + 1:
        duration = len(speech_activity) * frame_step
    baseline_activity = build_caption_activity_from_segments(segments, frame_step, duration)
    baseline_score = compute_activity_overlap_score(baseline_activity, speech_activity)
    candidates = skew_candidates or DEFAULT_SKEW_CANDIDATES
    best = {
        "shiftSeconds": 0.0,
        "skew": 1.0,
        "baselineScore": baseline_score,
        "bestScore": baseline_score,
        "improvement": 0.0,
    }

    allow_skew = _bool_env("AUTO_SYNC_ALLOW_SKEW", True)
    max_skew_delta = abs(_float_env("AUTO_SYNC_MAX_SKEW_DELTA", 0.035))
    for skew in candidates:
        if not allow_skew and abs(skew - 1.0) > 1e-9:
            continue
        if abs(skew - 1.0) > max_skew_delta:
            continue
        caption_activity = _retimed_activity(segments, skew, duration, frame_step)
        estimate = estimate_global_shift(caption_activity, speech_activity, frame_step, max_shift_seconds)
        score = float(estimate["bestScore"])
        if score > float(best["bestScore"]):
            best = {
                "shiftSeconds": estimate["shiftSeconds"],
                "skew": round(float(skew), 6),
                "baselineScore": round(baseline_score, 5),
                "bestScore": estimate["bestScore"],
                "improvement": round(score - baseline_score, 5),
            }

    report = {
        **best,
        "quality": best["bestScore"],
        "frameStep": frame_step,
        "captionActivityRanges": activity_to_ranges(baseline_activity, frame_step)[:120],
        "speechActivityRanges": speech.get("speechRanges", [])[:120],
        "vad": speech.get("vad", {}),
        "applied": False,
        "reason": "estimated",
        "warnings": [],
    }
    return SyncPassResult(copy.deepcopy(segments), report)


def apply_auto_sync_if_confident(
    segments: list[dict[str, Any]],
    audio_path: str,
    duration_seconds: float | None = None,
    config: dict[str, Any] | None = None,
) -> SyncPassResult:
    config = config or {}
    enabled = bool(config.get("enabled")) if "enabled" in config else _bool_env("ENABLE_AUTO_GLOBAL_SYNC", False)
    max_shift = float(config.get("maxShiftSeconds") or _float_env("AUTO_SYNC_MAX_SHIFT_SECONDS", 2.0))
    min_score = float(config.get("minScore") or _float_env("AUTO_SYNC_MIN_SCORE", 0.58))
    min_improvement = float(config.get("minImprovement") or _float_env("AUTO_SYNC_MIN_IMPROVEMENT", 0.04))
    max_estimated_ratio = float(config.get("maxEstimatedWordRatio") or _float_env("AUTO_SYNC_MAX_ESTIMATED_WORD_RATIO", 0.70))

    try:
        estimate = estimate_global_shift_and_skew(segments, audio_path, duration_seconds, max_shift)
    except Exception as exc:
        report = SyncReport(applied=False, reason="auto sync failed", warnings=[f"{type(exc).__name__}: {exc}"]).to_dict()
        return SyncPassResult(copy.deepcopy(segments), report)

    report = dict(estimate.report)
    report["enabled"] = enabled
    if not enabled:
        report["reason"] = "ENABLE_AUTO_GLOBAL_SYNC is false"
        report["rejectReason"] = "disabled"
        report["userMessage"] = "Auto Sync is disabled. Use manual sync or enable auto global sync."
        return SyncPassResult(copy.deepcopy(segments), report)

    shift = float(report.get("shiftSeconds") or 0.0)
    skew = float(report.get("skew") or 1.0)
    quality = float(report.get("quality") or 0.0)
    improvement = float(report.get("improvement") or 0.0)
    warnings = list(report.get("warnings") or [])
    estimated_ratio = _estimated_word_ratio(segments)
    report["estimatedWordRatio"] = round(estimated_ratio, 4)

    if quality < min_score:
        report.update({
            "applied": False,
            "reason": f"quality {quality:.3f} below threshold {min_score:.3f}",
            "rejectReason": "low_quality",
            "userMessage": "Auto Sync skipped because speech/caption activity confidence is too low.",
            "recommendation": {"shiftSeconds": shift, "skew": skew, "quality": quality},
            "warnings": warnings,
        })
        return SyncPassResult(copy.deepcopy(segments), report)
    if improvement < min_improvement:
        report.update({
            "applied": False,
            "reason": f"improvement {improvement:.3f} below threshold {min_improvement:.3f}",
            "rejectReason": "low_improvement",
            "userMessage": "Auto Sync found only a tiny correction, so it did not modify captions.",
            "recommendation": {"shiftSeconds": shift, "skew": skew, "quality": quality},
            "warnings": warnings,
        })
        return SyncPassResult(copy.deepcopy(segments), report)
    if abs(shift) > max_shift + 1e-6:
        report.update({
            "applied": False,
            "reason": "estimated shift exceeds sane range",
            "rejectReason": "shift_out_of_range",
            "userMessage": "Auto Sync skipped because the estimated correction is outside the safe range.",
            "recommendation": {"shiftSeconds": shift, "skew": skew, "quality": quality},
            "warnings": warnings,
        })
        return SyncPassResult(copy.deepcopy(segments), report)
    if estimated_ratio > max_estimated_ratio:
        report.update({
            "applied": False,
            "reason": f"estimated word ratio {estimated_ratio:.3f} is too high",
            "rejectReason": "too_many_estimated_word_timings",
            "userMessage": "Auto Sync skipped because word timings are estimated. Run High Quality Alignment first.",
            "recommendation": {"shiftSeconds": shift, "skew": skew, "quality": quality},
            "warnings": warnings,
        })
        return SyncPassResult(copy.deepcopy(segments), report)

    retimed = retime_segments(segments, shift_seconds=shift, skew=skew, anchor_seconds=0.0)
    for segment in retimed.segments:
        for word in segment.get("words") or []:
            word["timingSource"] = "auto_global_sync"
            word["timing_source"] = "auto_global_sync"
            word["timingSourceDetail"] = "auto_global_sync"
    warnings.extend(retimed.report.get("warnings") or [])
    report.update({
        "applied": True,
        "reason": "auto sync applied",
        "anchorSeconds": 0.0,
        "warnings": warnings[:100],
        "validation": retimed.report.get("validation"),
    })
    return SyncPassResult(retimed.segments, report)
