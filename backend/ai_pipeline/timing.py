import importlib.util
import json
import logging
import math
import os
import re
import shutil
import subprocess
from collections import Counter
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_PAUSE_SPLIT_THRESHOLD = float(os.getenv("PAUSE_SPLIT_THRESHOLD", "0.30") or 0.30)
PRODUCTION_INVALID_TIMING_SOURCES = {
    "provider_structured_estimate",
    "estimated",
    "interpolated",
    "segment_derived",
    "deterministic_fallback",
    "synthetic",
    "low_confidence_interpolated",
}


def _round_time(value: float) -> float:
    return round(max(0.0, float(value)), 3)


def _module_available(*names: str) -> bool:
    return any(importlib.util.find_spec(name) is not None for name in names)


def alignment_provider_status() -> dict[str, Any]:
    """Report optional timing providers without importing heavy packages."""
    provider = (os.getenv("ALIGNMENT_PROVIDER", "auto") or "auto").strip().lower()
    whisperx_enabled = os.getenv("ENABLE_WHISPERX", "false").strip().lower() == "true"
    stable_ts_enabled = os.getenv("ENABLE_STABLE_TS", "false").strip().lower() == "true"
    silero_enabled = os.getenv("ENABLE_SILERO_VAD", "false").strip().lower() == "true"
    whisperx_available = _module_available("whisperx")
    torch_available = _module_available("torch")
    torchaudio_available = _module_available("torchaudio")
    librosa_available = _module_available("librosa")
    stable_ts_available = _module_available("stable_whisper", "stable_ts")
    silero_available = _module_available("silero_vad") or _module_available("torch")
    ffmpeg_available = bool(shutil.which(os.getenv("FFMPEG_PATH") or "ffmpeg"))
    ffprobe_available = bool(shutil.which("ffprobe"))

    selected = "provider"
    if provider == "whisperx" or (provider == "auto" and whisperx_enabled and whisperx_available):
        selected = "whisperx"
    elif provider == "stable_ts" or (provider == "auto" and stable_ts_enabled and stable_ts_available):
        selected = "stable_ts"
    elif provider == "silero_vad_only" or (silero_enabled and silero_available):
        selected = "silero_vad_only"

    whisperx_ready = (
        whisperx_enabled
        and whisperx_available
        and torch_available
        and torchaudio_available
        and librosa_available
        and ffmpeg_available
        and ffprobe_available
    )
    stable_ts_ready = stable_ts_enabled and stable_ts_available and torch_available and ffmpeg_available and ffprobe_available
    real_forced_alignment_available = (
        (selected == "whisperx" and whisperx_ready)
        or (selected == "stable_ts" and stable_ts_ready)
    )
    unavailable_reasons: list[str] = []
    if provider in {"auto", "whisperx"} and whisperx_enabled:
        for name, available in (
            ("whisperx", whisperx_available),
            ("torch", torch_available),
            ("torchaudio", torchaudio_available),
            ("librosa", librosa_available),
            ("ffmpeg", ffmpeg_available),
            ("ffprobe", ffprobe_available),
        ):
            if not available:
                unavailable_reasons.append(f"{name}_missing")
    if provider in {"auto", "stable_ts"} and stable_ts_enabled:
        for name, available in (
            ("stable_ts", stable_ts_available),
            ("torch", torch_available),
            ("ffmpeg", ffmpeg_available),
            ("ffprobe", ffprobe_available),
        ):
            if not available:
                unavailable_reasons.append(f"{name}_missing")
    if not whisperx_enabled and not stable_ts_enabled:
        unavailable_reasons.append("forced_alignment_disabled")

    return {
        "alignmentProvider": provider,
        "selectedProvider": selected,
        "whisperxEnabled": whisperx_enabled,
        "stableTsEnabled": stable_ts_enabled,
        "sileroVadEnabled": silero_enabled,
        "whisperxAvailable": whisperx_available,
        "torchAvailable": torch_available,
        "torchaudioAvailable": torchaudio_available,
        "librosaAvailable": librosa_available,
        "stableTsAvailable": stable_ts_available,
        "sileroVadAvailable": silero_available,
        "ffmpegAvailable": ffmpeg_available,
        "ffprobeAvailable": ffprobe_available,
        "realForcedAlignmentAvailable": real_forced_alignment_available,
        "forcedAlignmentUnavailableReasons": sorted(set(unavailable_reasons)),
        "modelCacheDir": os.getenv("HF_HOME") or os.getenv("TRANSFORMERS_CACHE") or os.path.expanduser("~/.cache/huggingface"),
    }


def _ffprobe_duration(audio_path: str) -> float | None:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    try:
        result = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
            check=True,
            capture_output=True,
            text=True,
        )
        return max(0.0, float(result.stdout.strip()))
    except Exception as exc:
        logger.warning("ffprobe duration failed for %s: %s", audio_path, exc)
        return None


def detect_silence_gaps(audio_path: str, min_silence: float | None = None, threshold_db: str | None = None) -> dict[str, Any]:
    """Detect pauses using Silero VAD (if enabled) or FFmpeg silencedetect."""
    min_silence = DEFAULT_PAUSE_SPLIT_THRESHOLD if min_silence is None else max(0.1, float(min_silence))
    duration = _ffprobe_duration(audio_path)

    # 1. Try Silero VAD if enabled
    enable_silero = os.getenv("ENABLE_SILERO_VAD", "false").strip().lower() == "true"
    if enable_silero:
        try:
            from .aligner import TranscriptAligner
            aligner = TranscriptAligner()
            speech_map = aligner._compute_vad_speech_map(audio_path)
            duration_val = speech_map.get("duration") or duration or 0.0
            speech_ranges = speech_map.get("speechRanges") or []

            silence_gaps = []
            cursor = 0.0
            for r in speech_ranges:
                r_start = float(r["start"])
                r_end = float(r["end"])
                if r_start > cursor + min_silence:
                    silence_gaps.append({
                        "start": _round_time(cursor),
                        "end": _round_time(r_start),
                        "duration": _round_time(r_start - cursor)
                    })
                cursor = max(cursor, r_end)
            if duration_val > cursor + min_silence:
                silence_gaps.append({
                    "start": _round_time(cursor),
                    "end": _round_time(duration_val),
                    "duration": _round_time(duration_val - cursor)
                })

            speech_segments = [
                {"start": _round_time(r["start"]), "end": _round_time(r["end"]), "confidence": 0.85}
                for r in speech_ranges
            ]

            logger.info(
                "timing_silence_detected provider=silero_vad duration=%s speech_segments=%s silence_gaps=%s",
                duration_val,
                len(speech_segments),
                len(silence_gaps),
            )
            return {
                "provider": "silero_vad",
                "audioDuration": _round_time(duration_val),
                "speechSegments": speech_segments,
                "silenceGaps": silence_gaps,
                "thresholdSeconds": min_silence,
            }
        except Exception as exc:
            logger.warning("Silero VAD silence detection failed: %s. Falling back to FFmpeg.", exc)

    # 2. Fall back to FFmpeg silencedetect
    if threshold_db is None:
        env_threshold = os.getenv("SILENCE_THRESHOLD_DB")
        if env_threshold:
            threshold_db = env_threshold
        else:
            try:
                import soundfile as sf
                import numpy as np
                y, sr = sf.read(audio_path, dtype="float32", always_2d=False)
                if getattr(y, "ndim", 1) > 1:
                    y = np.mean(y, axis=1)
                if len(y) > 0:
                    volume_rms = np.sqrt(np.mean(np.square(y)))
                    volume_rms_db = 20 * np.log10(volume_rms + 1e-8)
                    adaptive_db = int(round(max(-35.0, min(-20.0, volume_rms_db + 2.5))))
                    threshold_db = f"{adaptive_db}dB"
                    logger.info("Computed adaptive silence threshold: %s (RMS volume: %.2f dB)", threshold_db, volume_rms_db)
                else:
                    threshold_db = "-30dB"
            except Exception as exc:
                logger.warning("Failed to compute adaptive silence threshold: %s. Using -30dB default.", exc)
                threshold_db = "-30dB"

    ffmpeg = shutil.which(os.getenv("FFMPEG_PATH") or "ffmpeg")
    if not ffmpeg:
        return {"provider": "none", "audioDuration": duration, "speechSegments": [], "silenceGaps": [], "error": "ffmpeg unavailable"}

    cmd = [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-i",
        audio_path,
        "-af",
        f"silencedetect=n={threshold_db}:d={min_silence}",
        "-f",
        "null",
        "-",
    ]
    try:
        result = subprocess.run(cmd, check=False, capture_output=True, text=True)
    except Exception as exc:
        logger.warning("silencedetect failed for %s: %s", audio_path, exc)
        return {"provider": "ffmpeg_silencedetect", "audioDuration": duration, "speechSegments": [], "silenceGaps": [], "error": str(exc)}

    silence_starts: list[float] = []
    silence_gaps: list[dict[str, float]] = []
    for line in (result.stderr or "").splitlines():
        start_match = re.search(r"silence_start:\s*([0-9.]+)", line)
        if start_match:
            silence_starts.append(float(start_match.group(1)))
            continue
        end_match = re.search(r"silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)", line)
        if end_match:
            start = silence_starts.pop(0) if silence_starts else max(0.0, float(end_match.group(1)) - float(end_match.group(2)))
            end = float(end_match.group(1))
            gap_duration = max(0.0, float(end_match.group(2)))
            if gap_duration >= min_silence:
                silence_gaps.append({"start": _round_time(start), "end": _round_time(end), "duration": _round_time(gap_duration)})

    if duration and silence_starts:
        for start in silence_starts:
            gap_duration = max(0.0, duration - start)
            if gap_duration >= min_silence:
                silence_gaps.append({"start": _round_time(start), "end": _round_time(duration), "duration": _round_time(gap_duration)})

    silence_gaps.sort(key=lambda gap: gap["start"])
    speech_segments: list[dict[str, float]] = []
    if duration and duration > 0:
        cursor = 0.0
        for gap in silence_gaps:
            if gap["start"] > cursor + 0.02:
                speech_segments.append({"start": _round_time(cursor), "end": _round_time(gap["start"]), "confidence": 0.65})
            cursor = max(cursor, gap["end"])
        if cursor < duration - 0.02:
            speech_segments.append({"start": _round_time(cursor), "end": _round_time(duration), "confidence": 0.65})

    logger.info(
        "timing_silence_detected provider=ffmpeg_silencedetect duration=%s speech_segments=%s silence_gaps=%s",
        duration,
        len(speech_segments),
        len(silence_gaps),
    )
    return {
        "provider": "ffmpeg_silencedetect",
        "audioDuration": _round_time(duration or 0.0) if duration else None,
        "speechSegments": speech_segments,
        "silenceGaps": silence_gaps,
        "thresholdSeconds": min_silence,
        "thresholdDb": threshold_db,
    }


def normalize_timing_source(raw_source: Any, provider: str | None = None) -> str:
    source = str(raw_source or "").lower()
    if "manual" in source:
        return "manual_adjustment_from_real"
    if "provider_structured" in source:
        return "provider_structured_estimate"
    if "segment_derived" in source:
        return "segment_derived"
    if "deterministic" in source:
        return "deterministic_fallback"
    if "low_confidence" in source:
        return "low_confidence_interpolated"
    if "interpolated" in source:
        return "interpolated"
    if "synthetic" in source:
        return "synthetic"
    if "estimated" in source or "fallback" in source:
        return "estimated"
    if "whisperx" in source or "whisperx_forced" in source:
        return "whisperx_forced"
    if "stable_ts_forced" in source:
        return "stable_ts_forced"
    if "stable_ts_order" in source or "stable_ts_adjusted" in source:
        return "interpolated"
    if "provider_native" in source or source == "provider_word":
        return "provider_native"
    if "vad" in source or "pause_preserved" in source:
        return "manual_adjustment_from_real"
    return "estimated"


def annotate_word_timing_sources(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for segment in segments:
        for word in segment.get("words") or []:
            detailed_source = str(
                word.get("timingSourceDetail")
                or word.get("timingSource")
                or word.get("timing_source")
                or ""
            ).strip()
            source = normalize_timing_source(detailed_source, word.get("provider"))
            word["timing_source"] = source
            word["timingSource"] = detailed_source or source
            word["timingSourceCategory"] = source
        if source in PRODUCTION_INVALID_TIMING_SOURCES:
            word["timing_warning"] = word.get("timing_warning") or "Estimated word timing; alignment provider did not return a real timestamp."
    return segments


def build_timing_report(
    segments: list[dict[str, Any]],
    silence_gaps: list[dict[str, Any]] | None = None,
    sync_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    words: list[dict[str, Any]] = []
    for segment in segments:
        words.extend(segment.get("words") or [])

    source_counts: Counter[str] = Counter()
    suspicious: list[str] = []
    durations: list[float] = []
    max_gap = 0.0
    prev_end: float | None = None
    estimated_words = 0

    for index, word in enumerate(words):
        source = normalize_timing_source(
            word.get("timingSourceCategory") or word.get("timing_source") or word.get("timingSource"),
            word.get("provider"),
        )
        source_counts[source] += 1
        if source in PRODUCTION_INVALID_TIMING_SOURCES:
            estimated_words += 1
        start = word.get("start")
        end = word.get("end")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or not math.isfinite(start) or not math.isfinite(end):
            suspicious.append(f"word[{index}] has invalid timestamp")
            continue
        if start < 0:
            suspicious.append(f"word[{index}] starts before zero")
        if end <= start:
            suspicious.append(f"word[{index}] end <= start")
        duration = max(0.0, end - start)
        durations.append(duration)
        if duration > 1.6:
            suspicious.append(f"word[{index}] duration {duration:.2f}s is unusually long")
        if prev_end is not None:
            if start < prev_end - 0.02:
                suspicious.append(f"word[{index}] overlaps previous word")
            max_gap = max(max_gap, start - prev_end)
        prev_end = end

    auto_sync = (sync_report or {}).get("autoGlobalSync") if isinstance(sync_report, dict) else {}
    stable_ts = (sync_report or {}).get("stableTs") if isinstance(sync_report, dict) else {}
    report = {
        "totalWords": len(words),
        "timingSourceCounts": dict(source_counts),
        "averageWordDuration": _round_time(sum(durations) / len(durations)) if durations else 0,
        "silenceGapCount": len(silence_gaps or []),
        "suspiciousWordCount": len(suspicious),
        "estimatedWordCount": estimated_words,
        "maxGapBetweenWords": _round_time(max_gap),
        "warnings": suspicious[:80],
        "syncMode": "auto" if auto_sync.get("applied") else "manual" if (sync_report or {}).get("manualSync", {}).get("applied") else "provider",
        "globalShiftSeconds": auto_sync.get("shiftSeconds", 0),
        "globalSkew": auto_sync.get("skew", 1.0),
        "autoSyncApplied": bool(auto_sync.get("applied")),
        "autoSyncQuality": auto_sync.get("quality", 0),
        "autoSyncImprovement": auto_sync.get("improvement", 0),
        "stableTsAppliedWords": stable_ts.get("appliedWords", 0),
        "stableTsCoverage": stable_ts.get("matchCoverage", 0),
        "speechActivityRanges": auto_sync.get("speechActivityRanges", [])[:80] if isinstance(auto_sync, dict) else [],
        "captionActivityRanges": auto_sync.get("captionActivityRanges", [])[:80] if isinstance(auto_sync, dict) else [],
        "exportOffsetParityCheck": "preview/export use stored corrected segments plus frontend global offset only",
    }
    if estimated_words:
        logger.warning("timing_estimated_words count=%s report=%s", estimated_words, json.dumps(report, ensure_ascii=False))
    else:
        logger.info("timing_validation report=%s", json.dumps(report, ensure_ascii=False))
    return report


def classify_caption_gaps(
    segments: list[dict[str, Any]],
    speech_segments: list[dict[str, Any]] | None = None,
    min_gap_seconds: float = 0.75,
) -> list[dict[str, Any]]:
    sorted_segments = sorted(
        [segment for segment in segments if isinstance(segment.get("start"), (int, float)) and isinstance(segment.get("end"), (int, float))],
        key=lambda item: item["start"],
    )
    speech_ranges = [
        (float(item.get("start")), float(item.get("end")))
        for item in speech_segments or []
        if isinstance(item, dict) and isinstance(item.get("start"), (int, float)) and isinstance(item.get("end"), (int, float))
    ]
    gaps: list[dict[str, Any]] = []
    for previous, current in zip(sorted_segments, sorted_segments[1:]):
        gap_start = float(previous["end"])
        gap_end = float(current["start"])
        duration = gap_end - gap_start
        if duration < min_gap_seconds:
            continue
        overlap = [
            {"start": max(gap_start, start), "end": min(gap_end, end)}
            for start, end in speech_ranges
            if min(gap_end, end) - max(gap_start, start) > 0.05
        ]
        if overlap:
            status = "speech"
            message = "Caption gap overlaps speech; missing caption words likely."
        elif speech_ranges:
            status = "silence"
            message = "Caption gap is during detected silence."
        else:
            status = "unknown"
            message = "Audio speech analysis missing; run timing debug or regenerate captions."
        gaps.append({
            "start": _round_time(gap_start),
            "end": _round_time(gap_end),
            "duration": _round_time(duration),
            "speechOverlapStatus": status,
            "message": message,
            "speechOverlaps": overlap[:10],
        })
    return gaps
