from __future__ import annotations

import copy
import importlib.util
import os
from typing import Any

from .affine import validate_monotonic_word_timing
from .aligned_words import aligned_word_quality, build_segments_from_aligned_words, canonical_aligned_words_from_segments
from .report import SyncPassResult
from .stable_refine import apply_stable_refinement, match_stable_words_to_provider_words, stable_ts_available


def _env_enabled(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() in {"1", "true", "yes", "on", "enabled"}


def whisperx_available() -> bool:
    return importlib.util.find_spec("whisperx") is not None


def high_quality_alignment_status() -> dict[str, Any]:
    stable_enabled = _env_enabled("ENABLE_STABLE_TS")
    whisperx_enabled = _env_enabled("ENABLE_WHISPERX")
    stable_available = stable_ts_available()
    whisper_available = whisperx_available()
    return {
        "highQualityAlignmentAvailable": (stable_enabled and stable_available) or (whisperx_enabled and whisper_available),
        "stableTsEnabled": stable_enabled,
        "stableTsAvailable": stable_available,
        "whisperxEnabled": whisperx_enabled,
        "whisperxAvailable": whisper_available,
    }


def _word_text(word: dict[str, Any]) -> str:
    return str(word.get("spokenWord") or word.get("originalWord") or word.get("displayedWord") or word.get("word") or "").strip()


def _flatten_words(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [word for segment in segments for word in (segment.get("words") or []) if isinstance(word, dict)]


def _prompt_segments_from_words(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prompt_segments: list[dict[str, Any]] = []
    for segment in segments:
        words = segment.get("words") or []
        text = " ".join(_word_text(word) for word in words if isinstance(word, dict) and _word_text(word)).strip()
        if not text:
            text = str(segment.get("text") or "").strip()
        if not text:
            continue
        start = float(segment.get("start") or 0.0)
        end = float(segment.get("end") or max(start + 1.0, 1.0))
        prompt_segments.append({"text": text, "start": round(max(0.0, start), 3), "end": round(max(start + 0.04, end), 3)})
    return prompt_segments


def _whisperx_model_id(language_mode: str) -> str:
    try:
        from ai_pipeline.config import MODEL_ALIGN_EN, MODEL_ALIGN_HI
    except Exception:
        MODEL_ALIGN_EN = "WAV2VEC2_ASR_BASE_960H"
        MODEL_ALIGN_HI = "theainerd/Wav2Vec2-large-xlsr-hindi"

    mode = str(language_mode or "").strip().lower()
    if mode in {"hindi", "hinglish", "hi", "auto_mixed_indian"}:
        return MODEL_ALIGN_HI
    return MODEL_ALIGN_EN


def _extract_whisperx_words(aligned_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for segment in aligned_segments or []:
        for word in segment.get("words") or []:
            if not isinstance(word, dict):
                continue
            source = str(word.get("timingSource") or word.get("timing_source") or "").lower()
            if source not in {"whisperx", "whisperx_forced"}:
                continue
            if word.get("start") is None or word.get("end") is None:
                continue
            words.append({"word": word.get("word") or word.get("text"), "start": word.get("start"), "end": word.get("end")})
    return words


def _apply_external_word_timings(
    segments: list[dict[str, Any]],
    external_words: list[dict[str, Any]],
    *,
    source: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    next_segments = copy.deepcopy(segments)
    provider_words = _flatten_words(next_segments)
    match_report = match_stable_words_to_provider_words(provider_words, external_words)
    matches = match_report.get("matches") or {}
    applied = 0
    for provider_index, external_index in matches.items():
        if provider_index >= len(provider_words) or external_index >= len(external_words):
            continue
        word = provider_words[provider_index]
        external = external_words[external_index]
        try:
            start = float(external.get("start"))
            end = float(external.get("end"))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        word["start"] = round(max(0.0, start), 3)
        word["end"] = round(max(0.0, end), 3)
        word["timingSource"] = source
        word["timing_source"] = source
        word["timingSourceDetail"] = source
        word.pop("timingNeedsReview", None)
        word.pop("timingReviewRequired", None)
        applied += 1
    validate_monotonic_word_timing(next_segments)
    return next_segments, {**match_report, "appliedWords": applied}


def _run_whisperx_alignment(
    segments: list[dict[str, Any]],
    audio_path: str,
    language_mode: str,
    chunking_rules: dict[str, Any] | None,
    status: dict[str, Any],
) -> SyncPassResult:
    try:
        from ai_pipeline.aligner import align_text

        aligned_segments = align_text(_prompt_segments_from_words(segments), audio_path, _whisperx_model_id(language_mode))
        whisper_words = _extract_whisperx_words(aligned_segments)
        if not whisper_words:
            return SyncPassResult(
                copy.deepcopy(segments),
                {
                    **status,
                    "applied": False,
                    "engine": "whisperx",
                    "reason": "whisperx produced no trusted word timings",
                    "userMessage": "WhisperX ran but did not produce trusted word timings. Try stable-ts high-quality alignment.",
                    **aligned_word_quality(segments),
                },
            )
        transferred_segments, match_report = _apply_external_word_timings(segments, whisper_words, source="whisperx_forced")
        if not match_report.get("appliedWords"):
            return SyncPassResult(
                copy.deepcopy(segments),
                {
                    **status,
                    "applied": False,
                    "engine": "whisperx",
                    "reason": "whisperx word timings did not match provider words",
                    "userMessage": "WhisperX alignment did not match the stored caption words closely enough.",
                    "whisperx": match_report,
                    **aligned_word_quality(segments),
                },
            )
        aligned_words = canonical_aligned_words_from_segments(transferred_segments)
        rebuilt = build_segments_from_aligned_words(aligned_words, chunking_rules=chunking_rules)
        return SyncPassResult(
            rebuilt,
            {
                **status,
                "applied": True,
                "engine": "whisperx",
                "reason": "WhisperX forced alignment applied",
                "whisperx": match_report,
                "captionBuild": {
                    "sourceOfTruth": "alignedWords",
                    "alignedWordCount": len(aligned_words),
                    "captionBlockCount": len(rebuilt),
                },
                **aligned_word_quality(rebuilt),
            },
        )
    except Exception as exc:
        return SyncPassResult(
            copy.deepcopy(segments),
            {
                **status,
                "applied": False,
                "engine": "whisperx",
                "reason": f"whisperx failed: {exc}",
                "userMessage": "WhisperX high-quality alignment failed. Captions were not changed.",
                **aligned_word_quality(segments),
            },
        )


def run_high_quality_alignment(
    segments: list[dict[str, Any]],
    audio_path: str,
    language_mode: str,
    *,
    chunking_rules: dict[str, Any] | None = None,
) -> SyncPassResult:
    status = high_quality_alignment_status()
    if not status["highQualityAlignmentAvailable"]:
        return SyncPassResult(
            copy.deepcopy(segments),
            {
                **status,
                "applied": False,
                "reason": "aligner_unavailable",
                "userMessage": (
                    "High Quality Alignment unavailable. Install requirements-optional-ai.txt and set "
                    "ENABLE_STABLE_TS=true or ENABLE_WHISPERX=true."
                ),
                **aligned_word_quality(segments),
            },
        )

    if status["stableTsEnabled"] and status["stableTsAvailable"]:
        stable_result = apply_stable_refinement(segments, audio_path, language_mode, config={"enabled": True})
        if stable_result.report.get("applied"):
            aligned_words = canonical_aligned_words_from_segments(stable_result.segments)
            rebuilt = build_segments_from_aligned_words(aligned_words, chunking_rules=chunking_rules)
            quality = aligned_word_quality(rebuilt)
            return SyncPassResult(
                rebuilt,
                {
                    **status,
                    "applied": True,
                    "engine": "stable-ts",
                    "reason": stable_result.report.get("reason", "stable-ts forced alignment applied"),
                    "stableTs": stable_result.report,
                    "captionBuild": {
                        "sourceOfTruth": "alignedWords",
                        "alignedWordCount": len(aligned_words),
                        "captionBlockCount": len(rebuilt),
                    },
                    **quality,
                },
            )
        return SyncPassResult(
            copy.deepcopy(segments),
            {
                **status,
                "applied": False,
                "engine": "stable-ts",
                "reason": stable_result.report.get("reason", "stable-ts did not apply"),
                "userMessage": stable_result.report.get("reason", "High Quality Alignment did not produce trusted word timings."),
                "stableTs": stable_result.report,
                **aligned_word_quality(segments),
            },
        )

    if status["whisperxEnabled"] and status["whisperxAvailable"]:
        return _run_whisperx_alignment(segments, audio_path, language_mode, chunking_rules, status)

    return SyncPassResult(copy.deepcopy(segments), {**status, "applied": False, "reason": "no aligner selected", **aligned_word_quality(segments)})
