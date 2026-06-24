from __future__ import annotations

import copy
import importlib.util
import math
import os
import re
from functools import lru_cache
from typing import Any

from .affine import validate_monotonic_word_timing
from .report import SyncPassResult


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


def _normalize_token(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _word_text(word: dict[str, Any]) -> str:
    return str(word.get("spokenWord") or word.get("originalWord") or word.get("displayedWord") or word.get("word") or "").strip()


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        numeric = float(value)
        return numeric if math.isfinite(numeric) else fallback
    except (TypeError, ValueError):
        return fallback


def _language_hint(language_mode: str) -> str | None:
    mode = (language_mode or "").lower()
    if mode in {"english", "en"}:
        return "en"
    if mode in {"hinglish", "hindi", "hi", "auto_mixed_indian"}:
        return "hi"
    if mode in {"telgish", "teluglish", "telugu", "te"}:
        return "te"
    return None


def stable_ts_available() -> bool:
    return importlib.util.find_spec("stable_whisper") is not None or importlib.util.find_spec("stable_ts") is not None


@lru_cache(maxsize=2)
def load_stable_ts_model(model_name: str, device: str):
    try:
        import stable_whisper
    except Exception:
        import stable_ts as stable_whisper  # type: ignore

    kwargs: dict[str, Any] = {}
    if device and device != "auto":
        kwargs["device"] = device
    try:
        return stable_whisper.load_model(model_name, **kwargs)
    except TypeError:
        return stable_whisper.load_model(model_name)


def _extract_words_from_result(result: Any) -> list[dict[str, Any]]:
    raw_words: list[Any] = []
    if hasattr(result, "all_words"):
        raw_words = list(result.all_words())
    elif isinstance(result, dict):
        for segment in result.get("segments") or []:
            raw_words.extend(segment.get("words") or [])
    elif hasattr(result, "segments"):
        for segment in result.segments:
            raw_words.extend(getattr(segment, "words", []) or [])

    words: list[dict[str, Any]] = []
    for item in raw_words:
        if isinstance(item, dict):
            text = item.get("word") or item.get("text")
            start = item.get("start")
            end = item.get("end")
        else:
            text = getattr(item, "word", None) or getattr(item, "text", None)
            start = getattr(item, "start", None)
            end = getattr(item, "end", None)
        if text is None or start is None or end is None:
            continue
        words.append({"word": str(text).strip(), "start": _safe_float(start), "end": _safe_float(end)})
    return words


def transcribe_stable_words(
    audio_path: str,
    language_mode: str,
    *,
    model_name: str | None = None,
    device: str | None = None,
) -> list[dict[str, Any]]:
    model_name = (model_name or os.getenv("STABLE_TS_MODEL", "base")).strip() or "base"
    device = (device or os.getenv("STABLE_TS_DEVICE", "auto")).strip() or "auto"
    model = load_stable_ts_model(model_name, device)
    kwargs: dict[str, Any] = {"word_timestamps": True}
    language = _language_hint(language_mode)
    if language:
        kwargs["language"] = language
    try:
        result = model.transcribe(audio_path, **kwargs)
    except TypeError:
        kwargs.pop("word_timestamps", None)
        result = model.transcribe(audio_path, **kwargs)
    return _extract_words_from_result(result)


def force_align_provider_words(
    segments: list[dict[str, Any]],
    audio_path: str,
    language_mode: str,
    *,
    model_name: str | None = None,
    device: str | None = None,
) -> list[dict[str, Any]]:
    model_name = (model_name or os.getenv("STABLE_TS_MODEL", "base")).strip() or "base"
    device = (device or os.getenv("STABLE_TS_DEVICE", "auto")).strip() or "auto"
    model = load_stable_ts_model(model_name, device)
    language = _language_hint(language_mode)
    align_input: list[dict[str, Any]] = []
    for segment in segments:
        words = segment.get("words") or []
        spoken_text = " ".join(_word_text(word) for word in words if _word_text(word)).strip()
        if not spoken_text:
            spoken_text = str(segment.get("text") or "").strip()
        if not spoken_text:
            continue
        align_input.append({
            "start": float(segment.get("start") or 0),
            "end": float(segment.get("end") or max(float(segment.get("start") or 0) + 1.0, 1.0)),
            "text": spoken_text,
        })
    if not align_input:
        return []
    if not hasattr(model, "align_words"):
        return []
    kwargs: dict[str, Any] = {"inplace": False, "verbose": None, "vad": False}
    if language:
        kwargs["language"] = language
    result = model.align_words(audio_path, align_input, **kwargs)
    return _extract_words_from_result(result)


def _flatten_provider_words(segments: list[dict[str, Any]]) -> list[tuple[int, int, dict[str, Any]]]:
    rows: list[tuple[int, int, dict[str, Any]]] = []
    for seg_index, segment in enumerate(segments):
        for word_index, word in enumerate(segment.get("words") or []):
            rows.append((seg_index, word_index, word))
    return rows


def match_stable_words_to_provider_words(
    provider_words: list[dict[str, Any]],
    stable_words: list[dict[str, Any]],
) -> dict[str, Any]:
    provider_tokens = [_normalize_token(_word_text(word)) for word in provider_words]
    stable_tokens = [_normalize_token(word.get("word")) for word in stable_words]
    used: set[int] = set()
    matches: dict[int, int] = {}
    search_from = 0
    for provider_index, token in enumerate(provider_tokens):
        if not token:
            continue
        for stable_index in range(search_from, len(stable_tokens)):
            if stable_index in used:
                continue
            if stable_tokens[stable_index] == token:
                matches[provider_index] = stable_index
                used.add(stable_index)
                search_from = stable_index + 1
                break
    coverage = len(matches) / max(1, len([token for token in provider_tokens if token]))
    ratio = len(stable_words) / max(1, len(provider_words))
    return {
        "matches": matches,
        "providerWordCount": len(provider_words),
        "stableWordCount": len(stable_words),
        "matchedWordCount": len(matches),
        "matchCoverage": round(coverage, 4),
        "wordRatio": round(ratio, 4),
    }


def _apply_matched_timings(
    segments: list[dict[str, Any]],
    rows: list[tuple[int, int, dict[str, Any]]],
    stable_words: list[dict[str, Any]],
    matches: dict[int, int],
    source: str,
) -> int:
    applied = 0
    for provider_index, stable_index in matches.items():
        if provider_index >= len(rows) or stable_index >= len(stable_words):
            continue
        _seg_index, _word_index, word = rows[provider_index]
        stable = stable_words[stable_index]
        start = _safe_float(stable.get("start"))
        end = _safe_float(stable.get("end"), start + 0.04)
        if end <= start:
            continue
        word["start"] = round(start, 3)
        word["end"] = round(end, 3)
        word["timingSource"] = source
        word["timing_source"] = source
        word["timingSourceDetail"] = source
        applied += 1
    validate_monotonic_word_timing(segments)
    return applied


def apply_stable_refinement(
    segments: list[dict[str, Any]],
    audio_path: str,
    language_mode: str,
    config: dict[str, Any] | None = None,
) -> SyncPassResult:
    config = config or {}
    enabled = bool(config.get("enabled")) if "enabled" in config else _bool_env("ENABLE_STABLE_TS", False)
    base_report: dict[str, Any] = {
        "enabled": enabled,
        "available": stable_ts_available(),
        "applied": False,
        "appliedWords": 0,
        "providerWordCount": 0,
        "stableWordCount": 0,
        "matchedWordCount": 0,
        "matchCoverage": 0.0,
        "orderFallbackUsed": False,
        "reason": "",
        "warnings": [],
    }
    if not enabled:
        base_report["reason"] = "ENABLE_STABLE_TS is false"
        return SyncPassResult(copy.deepcopy(segments), base_report)
    if not stable_ts_available():
        base_report["reason"] = "stable-ts is not installed"
        return SyncPassResult(copy.deepcopy(segments), base_report)

    next_segments = copy.deepcopy(segments)
    rows = _flatten_provider_words(next_segments)
    provider_words = [row[2] for row in rows]
    base_report["providerWordCount"] = len(provider_words)
    if not provider_words:
        base_report["reason"] = "no provider words"
        return SyncPassResult(next_segments, base_report)

    try:
        model_name = str(config.get("model") or os.getenv("STABLE_TS_MODEL", "base") or "base")
        device = str(config.get("device") or os.getenv("STABLE_TS_DEVICE", "auto") or "auto")
        stable_words = force_align_provider_words(
            next_segments,
            audio_path,
            language_mode,
            model_name=model_name,
            device=device,
        )
        stable_mode = "forced_align"
        if not stable_words:
            stable_words = transcribe_stable_words(
                audio_path,
                language_mode,
                model_name=model_name,
                device=device,
            )
            stable_mode = "transcribe"
    except Exception as exc:
        base_report["reason"] = "stable-ts failed"
        base_report["warnings"] = [f"{type(exc).__name__}: {exc}"]
        return SyncPassResult(next_segments, base_report)

    match = match_stable_words_to_provider_words(provider_words, stable_words)
    base_report.update({k: v for k, v in match.items() if k != "matches"})
    base_report["mode"] = stable_mode
    min_coverage = float(config.get("minMatchCoverage") or _float_env("STABLE_TS_MIN_MATCH_COVERAGE", 0.50))
    min_ratio = float(config.get("minWordRatio") or _float_env("STABLE_TS_MIN_WORD_RATIO", 0.45))
    max_ratio = float(config.get("maxWordRatio") or _float_env("STABLE_TS_MAX_WORD_RATIO", 2.25))
    ratio = float(match["wordRatio"])
    if ratio < min_ratio or ratio > max_ratio:
        base_report["reason"] = f"word ratio {ratio:.3f} outside allowed range"
        for word in provider_words:
            word["timingSourceDetail"] = "stable_ts_rejected"
        return SyncPassResult(next_segments, base_report)

    coverage = float(match["matchCoverage"])
    if coverage >= min_coverage:
        applied = _apply_matched_timings(next_segments, rows, stable_words, match["matches"], "stable_ts_forced_align" if stable_mode == "forced_align" else "stable_ts_adjusted")
        base_report.update({"applied": applied > 0, "appliedWords": applied, "reason": "token match timing transfer"})
        return SyncPassResult(next_segments, base_report)

    allow_order_fallback = bool(config.get("allowOrderFallback")) if "allowOrderFallback" in config else True
    if allow_order_fallback and min_ratio <= ratio <= max_ratio:
        count = min(len(provider_words), len(stable_words))
        order_matches = {idx: idx for idx in range(count)}
        applied = _apply_matched_timings(next_segments, rows, stable_words, order_matches, "stable_ts_order_adjusted")
        base_report.update({
            "applied": applied > 0,
            "appliedWords": applied,
            "orderFallbackUsed": True,
            "reason": "order fallback timing transfer",
            "warnings": [f"token coverage {coverage:.3f} below threshold {min_coverage:.3f}"],
        })
        return SyncPassResult(next_segments, base_report)

    base_report["reason"] = (
        f"token coverage {coverage:.3f} below threshold"
        if allow_order_fallback
        else f"token coverage {coverage:.3f} below threshold and order fallback is disabled"
    )
    return SyncPassResult(next_segments, base_report)
