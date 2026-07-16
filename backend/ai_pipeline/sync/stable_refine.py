from __future__ import annotations

import copy
import difflib
import importlib.util
import logging
import math
import os
import re
import subprocess
import tempfile
import threading
import unicodedata
from typing import Any

from .affine import validate_monotonic_word_timing
from .report import SyncPassResult
from ..language_modes import normalize_caption_text, romanizeMixedIndianText


logger = logging.getLogger(__name__)

DEFAULT_STABLE_TS_MIN_MATCH_COVERAGE = 0.50
DEFAULT_STABLE_TS_MIN_WORD_RATIO = 0.45
DEFAULT_STABLE_TS_MAX_WORD_RATIO = 2.25
DEFAULT_ALLOW_STABLE_TS_ORDER_FALLBACK = False


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


def resolved_stable_ts_config(config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    alignment_config = config.get("alignment") if isinstance(config.get("alignment"), dict) else {}
    return {
        "stableTsEnabled": bool(config.get("enabled")) if "enabled" in config else _bool_env("ENABLE_STABLE_TS", bool(alignment_config.get("stableTsEnabled", True))),
        "stableTsMinMatchCoverage": float(config.get("minMatchCoverage") or alignment_config.get("stableTsMinMatchCoverage") or _float_env("STABLE_TS_MIN_MATCH_COVERAGE", DEFAULT_STABLE_TS_MIN_MATCH_COVERAGE)),
        "stableTsMinWordRatio": float(config.get("minWordRatio") or alignment_config.get("stableTsMinWordRatio") or _float_env("STABLE_TS_MIN_WORD_RATIO", DEFAULT_STABLE_TS_MIN_WORD_RATIO)),
        "stableTsMaxWordRatio": float(config.get("maxWordRatio") or alignment_config.get("stableTsMaxWordRatio") or _float_env("STABLE_TS_MAX_WORD_RATIO", DEFAULT_STABLE_TS_MAX_WORD_RATIO)),
        "allowStableTsOrderFallback": DEFAULT_ALLOW_STABLE_TS_ORDER_FALLBACK,
    }


def _normalize_token(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).casefold()
    chars: list[str] = []
    for char in normalized:
        category = unicodedata.category(char)
        if category[0] in {"L", "M", "N"}:
            chars.append(char)
    return "".join(chars)


def _token_forms(value: Any) -> set[str]:
    raw = str(value or "").strip()
    forms = {_normalize_token(raw)}
    romanized = romanizeMixedIndianText(raw)
    forms.add(_normalize_token(romanized))
    forms.add(_normalize_token(normalize_caption_text(raw, "auto_mixed_indian")))
    number = _number_token_form(raw)
    if number:
        forms.add(number)
    return {form for form in forms if form}


_NUMBER_WORDS = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "eleven": "11",
    "twelve": "12",
    "ek": "1",
    "do": "2",
    "teen": "3",
    "char": "4",
    "chaar": "4",
    "paanch": "5",
    "panch": "5",
    "che": "6",
    "chhe": "6",
    "saat": "7",
    "aath": "8",
    "nau": "9",
    "das": "10",
    "gyarah": "11",
    "barah": "12",
    "okka": "1",
    "okati": "1",
    "rendu": "2",
    "moodu": "3",
    "nalu": "4",
    "naalugu": "4",
    "aidu": "5",
    "aaru": "6",
    "edu": "7",
    "enimidi": "8",
    "tommidi": "9",
    "padi": "10",
    "pannendu": "12",
}


def _number_token_form(value: Any) -> str | None:
    normalized = _normalize_token(value)
    if not normalized:
        return None
    if normalized.isdigit():
        return normalized
    return _NUMBER_WORDS.get(normalized)


def _tokens_equivalent(provider_forms: set[str], stable_forms: set[str]) -> bool:
    if provider_forms & stable_forms:
        return True
    for left in provider_forms:
        for right in stable_forms:
            if not left or not right:
                continue
            shorter = min(len(left), len(right))
            same_prefix = left[0] == right[0]
            near_same_length = abs(len(left) - len(right)) <= 1
            if (
                same_prefix
                and near_same_length
                and shorter >= 4
                and difflib.SequenceMatcher(a=left, b=right, autojunk=False).ratio() >= 0.84
            ):
                return True
            if same_prefix and shorter >= 5 and (left.startswith(right) or right.startswith(left)):
                return True
    return False


def _word_text(word: dict[str, Any]) -> str:
    return str(word.get("spokenWord") or word.get("originalWord") or word.get("displayedWord") or word.get("word") or "").strip()


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        numeric = float(value)
        return numeric if math.isfinite(numeric) else fallback
    except (TypeError, ValueError):
        return fallback


def _optional_float(value: Any) -> float | None:
    try:
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    except (TypeError, ValueError):
        return None


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


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)) or default)
    except (TypeError, ValueError):
        return default


_MODEL_LOAD_LOCK = threading.Lock()
_STABLE_TS_MODELS: dict[tuple[str, str, str], Any] = {}
_ALIGNMENT_SEMAPHORE = threading.BoundedSemaphore(max(1, _env_int("STABLE_TS_MAX_CONCURRENCY", 1)))


def _stable_ts_cache_dir() -> str:
    return (
        os.getenv("STABLE_TS_CACHE_DIR")
        or os.getenv("WHISPER_CACHE_DIR")
        or os.getenv("CAPINSTA_MODEL_CACHE_DIR")
        or os.path.join(os.path.expanduser("~"), ".cache", "capinsta", "stable-ts")
    )


def _cache_dir_writable(path: str) -> bool:
    try:
        os.makedirs(path, exist_ok=True)
        with tempfile.NamedTemporaryFile(prefix=".capinsta-stable-ts-", dir=path, delete=True):
            pass
        return True
    except Exception:
        return False


def _resolve_device(device: str) -> str:
    value = (device or "auto").strip().lower()
    if value and value != "auto":
        return value
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _audio_duration_seconds(audio_path: str) -> float | None:
    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                audio_path,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if completed.returncode != 0:
            return None
        duration = float((completed.stdout or "").strip())
        return duration if math.isfinite(duration) and duration > 0 else None
    except Exception:
        return None


def _import_stable_whisper():
    try:
        import stable_whisper

        return stable_whisper
    except ImportError:
        import stable_ts as stable_whisper  # type: ignore

        return stable_whisper


def _classify_stable_ts_exception(exc: BaseException) -> str:
    message = str(exc).lower()
    if isinstance(exc, ImportError) or "no module named" in message:
        return "stable_ts_import_failed"
    if isinstance(exc, MemoryError) or "out of memory" in message or "cannot allocate memory" in message:
        return "stable_ts_out_of_memory"
    if "ffmpeg" in message or "decode" in message or "audio" in message:
        return "stable_ts_audio_decode_failed"
    if "load_model" in message or "checkpoint" in message or "download" in message:
        return "stable_ts_model_load_failed"
    return "stable_ts_alignment_failed"


def load_stable_ts_model(model_name: str, device: str):
    cache_dir = _stable_ts_cache_dir()
    resolved_device = _resolve_device(device)
    cache_key = (model_name, resolved_device, cache_dir)
    with _MODEL_LOAD_LOCK:
        cached = _STABLE_TS_MODELS.get(cache_key)
        if cached is not None:
            return cached
        stable_whisper = _import_stable_whisper()
        kwargs: dict[str, Any] = {"device": resolved_device, "download_root": cache_dir}
        try:
            model = stable_whisper.load_model(model_name, **kwargs)
        except TypeError:
            kwargs.pop("download_root", None)
            try:
                model = stable_whisper.load_model(model_name, **kwargs)
            except TypeError:
                model = stable_whisper.load_model(model_name)
        _STABLE_TS_MODELS[cache_key] = model
        return model


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


def _group_id_for_segment(segment: dict[str, Any], seg_index: int) -> str:
    for key in ("alignmentGroupId", "turnId", "speakerTurnId"):
        value = segment.get(key)
        if value is not None and str(value).strip():
            return str(value)
    speaker = segment.get("speakerId")
    source_chunk = segment.get("sourceChunkIndex")
    return f"seg:{seg_index}:speaker:{speaker if speaker is not None else 'none'}:chunk:{source_chunk if source_chunk is not None else 'none'}"


def ensure_alignment_groups(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach stable alignment-island metadata without inventing speakers."""
    local_group_counts: dict[str, int] = {}
    for seg_index, segment in enumerate(segments):
        group_id = _group_id_for_segment(segment, seg_index)
        source_start = _optional_float(segment.get("sourceStart"))
        source_end = _optional_float(segment.get("sourceEnd"))
        native_start = _optional_float(segment.get("nativeStart"))
        native_end = _optional_float(segment.get("nativeEnd"))
        seg_start = _safe_float(segment.get("start"))
        seg_end = _safe_float(segment.get("end"), seg_start)
        if source_start is None:
            source_start = native_start if native_start is not None else seg_start
        if source_end is None:
            source_end = native_end if native_end is not None else seg_end
        segment["alignmentGroupId"] = group_id
        segment["sourceSegmentIndex"] = segment.get("sourceSegmentIndex", seg_index)
        segment["sourceStart"] = round(source_start, 3)
        segment["sourceEnd"] = round(max(source_end, source_start), 3)
        if native_start is not None:
            segment["nativeStart"] = native_start
        if native_end is not None:
            segment["nativeEnd"] = native_end
        for word_index, word in enumerate(segment.get("words") or []):
            if not isinstance(word, dict):
                continue
            word["alignmentGroupId"] = word.get("alignmentGroupId") or group_id
            word["sourceSegmentIndex"] = word.get("sourceSegmentIndex", segment["sourceSegmentIndex"])
            if "sourceChunkIndex" in segment and "sourceChunkIndex" not in word:
                word["sourceChunkIndex"] = segment.get("sourceChunkIndex")
            word["sourceWordIndex"] = word.get("sourceWordIndex", word_index)
            word["originalTokenIndex"] = word.get("originalTokenIndex", word["sourceWordIndex"])
            local_index = local_group_counts.get(str(word["alignmentGroupId"]), 0)
            word["localGroupTokenIndex"] = word.get("localGroupTokenIndex", local_index)
            local_group_counts[str(word["alignmentGroupId"])] = local_index + 1
            word["providerTokenId"] = word.get(
                "providerTokenId",
                f"{word['alignmentGroupId']}:{word['sourceSegmentIndex']}:{word['localGroupTokenIndex']}",
            )
            word["sourceStart"] = word.get("sourceStart", segment["sourceStart"])
            word["sourceEnd"] = word.get("sourceEnd", segment["sourceEnd"])
            word.setdefault("_preStableStart", word.get("start"))
            word.setdefault("_preStableEnd", word.get("end"))
            word.setdefault(
                "_preStableTimingSource",
                word.get("timingSourceDetail") or word.get("timingSource") or word.get("timing_source"),
            )
            if "speakerId" in segment and "speakerId" not in word:
                word["speakerId"] = segment.get("speakerId")
            if "turnId" in segment and "turnId" not in word:
                word["turnId"] = segment.get("turnId")
            word.setdefault("nativeStart", word.get("start"))
            word.setdefault("nativeEnd", word.get("end"))
    return segments


def _flatten_provider_words(segments: list[dict[str, Any]]) -> list[tuple[int, int, dict[str, Any]]]:
    rows: list[tuple[int, int, dict[str, Any]]] = []
    for seg_index, segment in enumerate(segments):
        for word_index, word in enumerate(segment.get("words") or []):
            rows.append((seg_index, word_index, word))
    return rows


def _word_group_bounds(word: dict[str, Any], tolerance: float) -> tuple[float, float]:
    start = _optional_float(word.get("sourceStart"))
    end = _optional_float(word.get("sourceEnd"))
    native_start = _optional_float(word.get("nativeStart"))
    native_end = _optional_float(word.get("nativeEnd"))
    word_start = _optional_float(word.get("start"))
    word_end = _optional_float(word.get("end"))
    if start is None and end is None and native_start is None and native_end is None and word_start is None and word_end is None:
        return float("-inf"), float("inf")
    if start is None:
        start = _safe_float(native_start, _safe_float(word_start))
    if end is None:
        end = _safe_float(native_end, _safe_float(word_end, start))
    if end < start:
        end = start
    return max(0.0, start - tolerance), end + tolerance


def _word_local_occurrence_bounds(word: dict[str, Any], tolerance: float) -> tuple[float, float] | None:
    start = _optional_float(word.get("localSourceStart"))
    end = _optional_float(word.get("localSourceEnd"))
    if start is None or end is None:
        start = _optional_float(word.get("nativeStart"))
        end = _optional_float(word.get("nativeEnd"))
    if start is None or end is None:
        start = _optional_float(word.get("_preStableStart"))
        end = _optional_float(word.get("_preStableEnd"))
    if start is None or end is None:
        start = _optional_float(word.get("start"))
        end = _optional_float(word.get("end"))
    if start is None or end is None:
        return None
    if end < start:
        end = start
    return max(0.0, start - tolerance), end + tolerance


def _stable_word_inside_provider_group(
    provider_word: dict[str, Any],
    stable_word: dict[str, Any],
    *,
    tolerance: float,
) -> bool:
    start = _optional_float(stable_word.get("start"))
    end = _optional_float(stable_word.get("end"))
    if start is None or end is None or end <= start:
        return False
    group_start, group_end = _word_group_bounds(provider_word, tolerance)
    midpoint = (start + end) / 2
    return group_start <= midpoint <= group_end


def _stable_word_inside_provider_local_occurrence(
    provider_word: dict[str, Any],
    stable_word: dict[str, Any],
    *,
    tolerance: float,
) -> bool:
    start = _optional_float(stable_word.get("start"))
    end = _optional_float(stable_word.get("end"))
    if start is None or end is None or end <= start:
        return False
    local_bounds = _word_local_occurrence_bounds(provider_word, tolerance)
    if local_bounds is None:
        return False
    local_start, local_end = local_bounds
    midpoint = (start + end) / 2
    return local_start <= midpoint <= local_end


def _trusted_native_occurrence_bounds(word: dict[str, Any], tolerance: float = 0.0) -> tuple[float, float] | None:
    timing_source = str(
        word.get("_preStableTimingSource")
        or word.get("timingSourceDetail")
        or word.get("timingSource")
        or word.get("timing_source")
        or ""
    ).lower()
    trusted_markers = (
        "provider_native",
        "provider_word",
        "native_provider_word",
    )
    untrusted_markers = (
        "deterministic",
        "fallback",
        "estimated",
        "interpolated",
        "provider_phrase",
        "segment_derived",
        "structured",
        "low_confidence",
    )
    if not any(marker in timing_source for marker in trusted_markers):
        return None
    if any(marker in timing_source for marker in untrusted_markers):
        return None
    start = _optional_float(word.get("nativeStart"))
    end = _optional_float(word.get("nativeEnd"))
    if start is None or end is None or end <= start:
        return None
    return max(0.0, start - tolerance), end + tolerance


def _stable_word_has_native_duration_contradiction(
    provider_word: dict[str, Any],
    stable_word: dict[str, Any],
    *,
    timing_tolerance: float = 0.12,
    min_duration_ratio: float = 0.35,
    max_duration_ratio: float = 2.0,
    min_absolute_duration_delta: float = 0.18,
) -> bool:
    native_bounds = _trusted_native_occurrence_bounds(provider_word, timing_tolerance)
    if native_bounds is None:
        return False
    stable_start = _optional_float(stable_word.get("start"))
    stable_end = _optional_float(stable_word.get("end"))
    if stable_start is None or stable_end is None or stable_end <= stable_start:
        return True

    native_start, native_end = native_bounds
    native_duration = max(native_end - native_start, 1e-6)
    stable_duration = stable_end - stable_start
    duration_delta = abs(stable_duration - native_duration)
    duration_ratio = stable_duration / native_duration
    midpoint = (stable_start + stable_end) / 2
    outside_native_occurrence = midpoint < native_start or midpoint > native_end
    duration_outlier = (
        duration_delta >= min_absolute_duration_delta
        and (duration_ratio < min_duration_ratio or duration_ratio > max_duration_ratio)
    )
    return outside_native_occurrence and duration_outlier


def _stable_rejection_sample(
    provider_index: int,
    stable_index: int,
    provider_word: dict[str, Any],
    stable_word: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    return {
        "reason": reason,
        "providerIndex": provider_index,
        "stableIndex": stable_index,
        "providerTokenId": provider_word.get("providerTokenId"),
        "word": _word_text(provider_word),
        "alignmentGroupId": provider_word.get("alignmentGroupId"),
        "localGroupTokenIndex": provider_word.get("localGroupTokenIndex"),
        "sourceSegmentIndex": provider_word.get("sourceSegmentIndex"),
        "sourceStart": provider_word.get("sourceStart"),
        "sourceEnd": provider_word.get("sourceEnd"),
        "localSourceStart": provider_word.get("localSourceStart"),
        "localSourceEnd": provider_word.get("localSourceEnd"),
        "nativeStart": provider_word.get("nativeStart"),
        "nativeEnd": provider_word.get("nativeEnd"),
        "stableWord": stable_word.get("word"),
        "stableStart": stable_word.get("start"),
        "stableEnd": stable_word.get("end"),
    }


def _stable_word_fits_another_equivalent_local_occurrence(
    provider_words: list[dict[str, Any]],
    provider_tokens: list[set[str]],
    provider_indexes: list[int],
    provider_index: int,
    stable_word: dict[str, Any],
    token: set[str],
    *,
    tolerance: float,
) -> bool:
    for other_provider_index in provider_indexes:
        if other_provider_index == provider_index:
            continue
        if not _tokens_equivalent(token, provider_tokens[other_provider_index]):
            continue
        if _stable_word_inside_provider_local_occurrence(
            provider_words[other_provider_index],
            stable_word,
            tolerance=tolerance,
        ):
            return True
    return False


def match_stable_words_to_provider_words(
    provider_words: list[dict[str, Any]],
    stable_words: list[dict[str, Any]],
    *,
    boundary_tolerance: float = 0.08,
    local_occurrence_tolerance: float = 0.35,
    require_alignment_groups: bool = False,
) -> dict[str, Any]:
    provider_tokens = [_token_forms(_word_text(word)) for word in provider_words]
    stable_tokens = [_token_forms(word.get("word")) for word in stable_words]
    used: set[int] = set()
    matches: dict[int, int] = {}
    provider_groups: dict[str, list[int]] = {}
    missing_group_words = 0
    ambiguous_rejected_words = 0
    duration_outlier_rejected: set[int] = set()
    rejection_samples: list[dict[str, Any]] = []
    for provider_index, word in enumerate(provider_words):
        group_id = str(word.get("alignmentGroupId") or "").strip()
        if not group_id:
            missing_group_words += 1
            if require_alignment_groups:
                continue
            group_id = f"unscoped:{provider_index}"
        provider_groups.setdefault(group_id, []).append(provider_index)

    for _group_id, provider_indexes in provider_groups.items():
        group_stable_indexes = [
            stable_index
            for stable_index, stable_word in enumerate(stable_words)
            if any(
                _stable_word_inside_provider_group(provider_words[provider_index], stable_word, tolerance=boundary_tolerance)
                for provider_index in provider_indexes
            )
        ]
        search_position = 0
        for provider_index in provider_indexes:
            token = provider_tokens[provider_index]
            if not token:
                continue
            local_match: tuple[int, int] | None = None
            broad_match: tuple[int, int] | None = None
            for stable_position in range(search_position, len(group_stable_indexes)):
                stable_index = group_stable_indexes[stable_position]
                if stable_index in used:
                    continue
                if not _tokens_equivalent(token, stable_tokens[stable_index]):
                    continue
                if not _stable_word_inside_provider_group(
                    provider_words[provider_index],
                    stable_words[stable_index],
                    tolerance=boundary_tolerance,
                ):
                    continue
                if _stable_word_has_native_duration_contradiction(
                    provider_words[provider_index],
                    stable_words[stable_index],
                ):
                    duration_outlier_rejected.add(provider_index)
                    if len(rejection_samples) < 20:
                        rejection_samples.append(
                            _stable_rejection_sample(
                                provider_index,
                                stable_index,
                                provider_words[provider_index],
                                stable_words[stable_index],
                                "stable_ts_native_duration_outlier",
                            )
                        )
                    continue
                if _stable_word_inside_provider_local_occurrence(
                    provider_words[provider_index],
                    stable_words[stable_index],
                    tolerance=local_occurrence_tolerance,
                ):
                    local_match = (stable_position, stable_index)
                    break
                if broad_match is None:
                    broad_match = (stable_position, stable_index)

            selected_match = local_match
            if selected_match is None and broad_match is not None:
                stable_position, stable_index = broad_match
                if _stable_word_fits_another_equivalent_local_occurrence(
                    provider_words,
                    provider_tokens,
                    provider_indexes,
                    provider_index,
                    stable_words[stable_index],
                    token,
                    tolerance=local_occurrence_tolerance,
                ):
                    ambiguous_rejected_words += 1
                    if len(rejection_samples) < 20:
                        rejection_samples.append(
                            _stable_rejection_sample(
                                provider_index,
                                stable_index,
                                provider_words[provider_index],
                                stable_words[stable_index],
                                "stable_ts_ambiguous_repeated_occurrence",
                            )
                        )
                    continue
                selected_match = broad_match

            if selected_match is not None:
                stable_position, stable_index = selected_match
                matches[provider_index] = stable_index
                used.add(stable_index)
                search_position = stable_position + 1
                continue
    coverage = len(matches) / max(1, len([token for token in provider_tokens if token]))
    ratio = len(stable_words) / max(1, len(provider_words))
    return {
        "matches": matches,
        "providerWordCount": len(provider_words),
        "stableWordCount": len(stable_words),
        "matchedWordCount": len(matches),
        "matchCoverage": round(coverage, 4),
        "wordRatio": round(ratio, 4),
        "missingAlignmentGroupWords": missing_group_words,
        "ambiguousRepeatedTokenRejectedWords": ambiguous_rejected_words,
        "durationOutlierRejectedWords": len(duration_outlier_rejected),
        "rejectionSamples": rejection_samples,
    }


def _mark_stable_rejected(word: dict[str, Any], reason: str) -> None:
    word["timingNeedsReview"] = True
    word["timingReviewRequired"] = True
    word["timingRepairReason"] = reason
    if not str(word.get("timingSource") or word.get("timing_source") or "").startswith("provider_native"):
        word["timingSource"] = word.get("timingSource") or "provider_native_unconfirmed"
        word["timing_source"] = word.get("timing_source") or "provider_native_unconfirmed"
        word["timingSourceDetail"] = word.get("timingSourceDetail") or "provider_native_unconfirmed"


def _stable_group_order_valid(group_words: list[dict[str, Any]]) -> tuple[bool, str | None]:
    previous_end: float | None = None
    for word in sorted(group_words, key=lambda item: int(item.get("localGroupTokenIndex") or 0)):
        start = _optional_float(word.get("start"))
        end = _optional_float(word.get("end"))
        if start is None or end is None or end <= start:
            return False, "invalid_range"
        group_start, group_end = _word_group_bounds(word, 0.0)
        if start < group_start - 1e-6 or end > group_end + 1e-6:
            return False, "outside_group_window"
        if previous_end is not None and start < previous_end - 1e-6:
            return False, "source_order_violation"
        previous_end = end
    return True, None


def _restore_pre_stable_word(word: dict[str, Any], reason: str) -> bool:
    source = str(word.get("timingSourceDetail") or word.get("timingSource") or word.get("timing_source") or "")
    if "stable_ts" not in source:
        return False
    pre_start = _optional_float(word.get("_preStableStart"))
    pre_end = _optional_float(word.get("_preStableEnd"))
    if pre_start is None or pre_end is None or pre_end <= pre_start:
        return False
    word["stableTsRejectedStart"] = word.get("start")
    word["stableTsRejectedEnd"] = word.get("end")
    word["stableTsRejectedReason"] = reason
    word["start"] = round(pre_start, 3)
    word["end"] = round(pre_end, 3)
    previous_source = str(word.get("_preStableTimingSource") or "deterministic_fallback")
    word["timingSource"] = previous_source
    word["timing_source"] = previous_source
    word["timingSourceDetail"] = previous_source
    word["timingNeedsReview"] = True
    word["timingReviewRequired"] = True
    word["timingRepairReason"] = "stable_ts_group_candidate_rolled_back"
    return True


def _rollback_unordered_words_locally(group_words: list[dict[str, Any]]) -> tuple[int, str | None]:
    ordered = sorted(group_words, key=lambda item: int(item.get("localGroupTokenIndex") or 0))
    rolled_back = 0
    last_reason: str | None = None
    max_passes = max(1, len(ordered) * 2)
    for _ in range(max_passes):
        previous_word: dict[str, Any] | None = None
        previous_end: float | None = None
        changed = False
        for word in ordered:
            start = _optional_float(word.get("start"))
            end = _optional_float(word.get("end"))
            group_start, group_end = _word_group_bounds(word, 0.0)
            reason: str | None = None
            if start is None or end is None or end <= start:
                reason = "invalid_range"
            elif start < group_start - 1e-6 or end > group_end + 1e-6:
                reason = "outside_group_window"
            elif previous_end is not None and start < previous_end - 1e-6:
                reason = "source_order_violation"

            if reason is None:
                previous_word = word
                previous_end = end
                continue

            if _restore_pre_stable_word(word, reason):
                rolled_back += 1
                last_reason = reason
                changed = True
                break
            if previous_word is not None and _restore_pre_stable_word(previous_word, reason):
                rolled_back += 1
                last_reason = reason
                changed = True
                break
            previous_word = word
            previous_end = end
        if not changed:
            break
    return rolled_back, last_reason


def _rollback_invalid_stable_groups(
    rows: list[tuple[int, int, dict[str, Any]]],
    diagnostics: dict[str, Any] | None = None,
) -> int:
    groups: dict[str, list[dict[str, Any]]] = {}
    for _seg_index, _word_index, word in rows:
        group_id = str(word.get("alignmentGroupId") or "").strip()
        if not group_id:
            continue
        groups.setdefault(group_id, []).append(word)

    rolled_back = 0
    samples: list[dict[str, Any]] = []
    for group_id, group_words in groups.items():
        valid, reason = _stable_group_order_valid(group_words)
        if valid:
            continue

        group_rollback_count, local_reason = _rollback_unordered_words_locally(group_words)
        final_valid, final_reason = _stable_group_order_valid(group_words)

        if group_rollback_count:
            rolled_back += group_rollback_count
            if len(samples) < 20:
                samples.append(
                    {
                        "alignmentGroupId": group_id,
                        "reason": local_reason or reason,
                        "finalViolation": None if final_valid else final_reason,
                        "rolledBackWords": group_rollback_count,
                        "groupStart": min((_optional_float(word.get("sourceStart")) or 0.0) for word in group_words),
                        "groupEnd": max((_optional_float(word.get("sourceEnd")) or 0.0) for word in group_words),
                    }
                )

    if diagnostics is not None:
        diagnostics["stableTsGroupRollbackWords"] = int(diagnostics.get("stableTsGroupRollbackWords") or 0) + rolled_back
        if samples:
            diagnostics.setdefault("stableTsGroupRollbackSamples", []).extend(samples)
    if rolled_back:
        logger.warning(
            "stable_ts_group_candidate_rolled_back count=%d samples=%s",
            rolled_back,
            samples,
        )
    return rolled_back


def _apply_matched_timings(
    segments: list[dict[str, Any]],
    rows: list[tuple[int, int, dict[str, Any]]],
    stable_words: list[dict[str, Any]],
    matches: dict[int, int],
    source: str,
    *,
    boundary_tolerance: float = 0.08,
    diagnostics: dict[str, Any] | None = None,
    rollback_and_validate: bool = True,
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
            _mark_stable_rejected(word, "stable_ts_invalid_range_rejected")
            continue
        if not _stable_word_inside_provider_group(word, stable, tolerance=boundary_tolerance):
            _mark_stable_rejected(word, "stable_ts_cross_boundary_rejected")
            continue
        word["start"] = round(start, 3)
        word["end"] = round(end, 3)
        word["stableTsTokenIndex"] = stable_index
        word["stableTsCandidateStart"] = round(start, 3)
        word["stableTsCandidateEnd"] = round(end, 3)
        word["timingSource"] = source
        word["timing_source"] = source
        word["timingSourceDetail"] = source
        word["timingQualityMode"] = "word_timed_verified"
        word["alignmentRecoverySource"] = source
        applied += 1
    if rollback_and_validate:
        rolled_back = _rollback_invalid_stable_groups(rows, diagnostics)
        validate_monotonic_word_timing(segments)
        return max(0, applied - rolled_back)
    return applied


def _segment_window(segment: dict[str, Any]) -> tuple[float, float] | None:
    start = _optional_float(segment.get("sourceStart"))
    end = _optional_float(segment.get("sourceEnd"))
    if start is None:
        start = _optional_float(segment.get("start"))
    if end is None:
        end = _optional_float(segment.get("end"))
    if start is None or end is None or end <= start:
        return None
    return start, end


def _valid_word_timing(word: dict[str, Any], window: tuple[float, float] | None = None) -> bool:
    start = _optional_float(word.get("start"))
    end = _optional_float(word.get("end"))
    if start is None or end is None or end <= start:
        return False
    if window is None:
        return True
    return start >= window[0] - 0.001 and end <= window[1] + 0.001


def _recovery_source_for_existing_words(words: list[dict[str, Any]], window: tuple[float, float] | None) -> str | None:
    if not words or not all(_valid_word_timing(word, window) for word in words):
        return None
    source_blob = " ".join(
        str(word.get("timingSourceDetail") or word.get("timingSource") or word.get("timing_source") or "")
        for word in words
    ).lower()
    if any(marker in source_blob for marker in ("provider_native", "provider_word", "native_provider_word")) and not any(
        marker in source_blob for marker in ("provider_phrase", "estimated", "interpolated", "fallback", "segment_derived")
    ):
        return "provider_native_word_timestamps"
    return "provider_segment_interpolation"


def _mark_recovered_words(
    words: list[dict[str, Any]],
    *,
    quality_mode: str,
    recovery_source: str,
    review: bool,
) -> None:
    for word in words:
        word["timingQualityMode"] = quality_mode
        word["alignmentRecoverySource"] = recovery_source
        if review:
            word["timingNeedsReview"] = True
            word["timingReviewRequired"] = True


def _interpolate_words_in_window(words: list[dict[str, Any]], window: tuple[float, float], source: str) -> bool:
    if not words:
        return False
    start, end = window
    duration = max(0.001, end - start)
    step = duration / len(words)
    cursor = start
    for index, word in enumerate(words):
        word_start = round(cursor, 3)
        word_end = round(end if index == len(words) - 1 else min(end, cursor + step), 3)
        if word_end <= word_start:
            word_end = round(min(end, word_start + 0.001), 3)
        word["start"] = word_start
        word["end"] = word_end
        word["timingSource"] = source
        word["timing_source"] = source
        word["timingSourceDetail"] = source
        word["timingQualityMode"] = "word_timed_estimated"
        word["alignmentRecoverySource"] = source
        word["timingNeedsReview"] = True
        word["timingReviewRequired"] = True
        cursor = word_end
    return True


def _mark_phrase_fallback(segment: dict[str, Any], reason: str) -> None:
    window = _segment_window(segment)
    if window:
        segment["start"] = round(window[0], 3)
        segment["end"] = round(window[1], 3)
    segment["timingQualityMode"] = "phrase_timed_fallback"
    segment["alignmentRecoverySource"] = "phrase_timed_fallback"
    segment["timingSource"] = "phrase_timed_fallback"
    segment["timing_source"] = "phrase_timed_fallback"
    segment["timingSourceDetail"] = reason
    segment["timingNeedsReview"] = True
    segment["timingReviewRequired"] = True
    segment["disableActiveWordHighlighting"] = True
    for word in segment.get("words") or []:
        word["timingQualityMode"] = "phrase_timed_fallback"
        word["alignmentRecoverySource"] = "phrase_timed_fallback"
        word["disableActiveWordHighlighting"] = True
        word["timingNeedsReview"] = True
        word["timingReviewRequired"] = True


def _mark_unusable(segment: dict[str, Any], reason: str) -> None:
    segment["timingQualityMode"] = "unusable"
    segment["alignmentRecoverySource"] = "unusable"
    segment["timingSourceDetail"] = reason
    segment["timingNeedsReview"] = True
    segment["timingReviewRequired"] = True
    segment["disableActiveWordHighlighting"] = True
    for word in segment.get("words") or []:
        word["timingQualityMode"] = "unusable"
        word["alignmentRecoverySource"] = "unusable"
        word["disableActiveWordHighlighting"] = True


def _speech_window_for_segment(
    segment: dict[str, Any],
    speech_ranges: list[dict[str, Any]] | None,
) -> tuple[float, float] | None:
    if not speech_ranges:
        return None
    segment_window = _segment_window(segment)
    best_window: tuple[float, float] | None = None
    best_overlap = 0.0
    for speech_range in speech_ranges:
        speech_start = _optional_float(speech_range.get("start"))
        speech_end = _optional_float(speech_range.get("end"))
        if speech_start is None or speech_end is None or speech_end <= speech_start:
            continue
        if segment_window is None:
            overlap = speech_end - speech_start
            candidate = (speech_start, speech_end)
        else:
            start = max(segment_window[0], speech_start)
            end = min(segment_window[1], speech_end)
            overlap = end - start
            candidate = (start, end)
        if overlap > best_overlap and candidate[1] > candidate[0]:
            best_overlap = overlap
            best_window = candidate
    return best_window


def _recover_segment(
    segment: dict[str, Any],
    reason: str,
    *,
    speech_ranges: list[dict[str, Any]] | None = None,
) -> str:
    words = [word for word in segment.get("words") or [] if isinstance(word, dict)]
    window = _segment_window(segment)
    source = _recovery_source_for_existing_words(words, window)
    if source == "provider_native_word_timestamps":
        _mark_recovered_words(words, quality_mode="word_timed_verified", recovery_source=source, review=False)
        return source
    if source:
        _mark_recovered_words(words, quality_mode="word_timed_estimated", recovery_source=source, review=True)
        return source
    if words and window and _interpolate_words_in_window(words, window, "provider_segment_interpolation"):
        return "provider_segment_interpolation"
    speech_window = _speech_window_for_segment(segment, speech_ranges)
    if words and speech_window and _interpolate_words_in_window(words, speech_window, "vad_speech_interpolation"):
        return "vad_speech_interpolation"
    if window:
        _mark_phrase_fallback(segment, reason)
        return "phrase_timed_fallback"
    _mark_unusable(segment, reason)
    return "unusable"


def _quality_counts(segments: list[dict[str, Any]]) -> dict[str, int]:
    verified = 0
    estimated = 0
    phrase = 0
    for segment in segments:
        if segment.get("timingQualityMode") == "phrase_timed_fallback":
            phrase += 1
        for word in segment.get("words") or []:
            mode = word.get("timingQualityMode") or segment.get("timingQualityMode")
            if mode == "word_timed_verified":
                verified += 1
            elif mode == "word_timed_estimated":
                estimated += 1
            elif mode == "phrase_timed_fallback":
                phrase += 1
    return {
        "verifiedWordCount": verified,
        "estimatedWordCount": estimated,
        "phraseFallbackCueCount": phrase,
    }


def _final_timing_quality_mode(segments: list[dict[str, Any]]) -> str:
    modes = [
        str(word.get("timingQualityMode") or segment.get("timingQualityMode") or "")
        for segment in segments
        for word in (segment.get("words") or [{}])
    ]
    if not modes or all(mode == "unusable" for mode in modes):
        return "unusable"
    if any(mode == "phrase_timed_fallback" for mode in modes):
        return "phrase_timed_fallback"
    if any(mode == "word_timed_estimated" for mode in modes):
        return "word_timed_estimated"
    if any(mode == "word_timed_verified" for mode in modes):
        return "word_timed_verified"
    return "unusable"


def _record_group_recovery(
    report: dict[str, Any],
    segment: dict[str, Any],
    *,
    reason: str,
    recovery_source: str,
    match: dict[str, Any] | None = None,
    accepted: bool = False,
) -> None:
    group_id = str(segment.get("alignmentGroupId") or segment.get("id") or f"group_{len(report.get('perGroup', [])) + 1:04d}")
    window = _segment_window(segment)
    entry = {
        "groupId": group_id,
        "start": round(window[0], 3) if window else None,
        "end": round(window[1], 3) if window else None,
        "providerWordCount": int((match or {}).get("providerWordCount") or len(segment.get("words") or [])),
        "stableWordCount": int((match or {}).get("stableWordCount") or 0),
        "matchedWordCount": int((match or {}).get("matchedWordCount") or 0),
        "matchCoverage": float((match or {}).get("matchCoverage") or 0.0),
        "wordRatio": float((match or {}).get("wordRatio") or 0.0),
        "accepted": accepted,
        "reason": reason,
        "recoverySource": recovery_source,
    }
    report.setdefault("perGroup", []).append(entry)
    report.setdefault("recoveryByGroup", {})[group_id] = recovery_source
    if not accepted:
        report.setdefault("failedGroupIds", []).append(group_id)


def _finalize_recovery_report(report: dict[str, Any], segments: list[dict[str, Any]]) -> None:
    report.update(_quality_counts(segments))
    report["finalTimingQualityMode"] = _final_timing_quality_mode(segments)


def _stable_words_for_window(stable_words: list[dict[str, Any]], window: tuple[float, float] | None, tolerance: float) -> list[dict[str, Any]]:
    if window is None:
        return []
    start, end = window
    selected: list[dict[str, Any]] = []
    for word in stable_words:
        word_start = _optional_float(word.get("start"))
        word_end = _optional_float(word.get("end"))
        if word_start is None or word_end is None or word_end <= word_start:
            continue
        midpoint = (word_start + word_end) / 2
        if start - tolerance <= midpoint <= end + tolerance:
            selected.append(word)
    return selected


def _apply_group_stable_matches(
    segment: dict[str, Any],
    stable_words: list[dict[str, Any]],
    matches: dict[int, int],
    source: str,
    *,
    boundary_tolerance: float,
) -> int:
    words = [word for word in segment.get("words") or [] if isinstance(word, dict)]
    applied = 0
    for provider_index, stable_index in matches.items():
        if provider_index >= len(words) or stable_index >= len(stable_words):
            continue
        provider_word = words[provider_index]
        stable_word = stable_words[stable_index]
        start = _optional_float(stable_word.get("start"))
        end = _optional_float(stable_word.get("end"))
        if start is None or end is None or end <= start:
            _mark_stable_rejected(provider_word, "stable_ts_invalid_range_rejected")
            continue
        if not _stable_word_inside_provider_group(provider_word, stable_word, tolerance=boundary_tolerance):
            _mark_stable_rejected(provider_word, "stable_ts_cross_boundary_rejected")
            continue
        provider_word["start"] = round(start, 3)
        provider_word["end"] = round(end, 3)
        provider_word["stableTsTokenIndex"] = stable_index
        provider_word["stableTsCandidateStart"] = round(start, 3)
        provider_word["stableTsCandidateEnd"] = round(end, 3)
        provider_word["timingSource"] = source
        provider_word["timing_source"] = source
        provider_word["timingSourceDetail"] = source
        provider_word["timingQualityMode"] = "word_timed_verified"
        provider_word["alignmentRecoverySource"] = source
        applied += 1
    return applied


def _recover_all_segments(
    segments: list[dict[str, Any]],
    report: dict[str, Any],
    reason: str,
    *,
    speech_ranges: list[dict[str, Any]] | None = None,
) -> SyncPassResult:
    for segment in segments:
        recovery_source = _recover_segment(segment, reason, speech_ranges=speech_ranges)
        _record_group_recovery(report, segment, reason=reason, recovery_source=recovery_source, accepted=False)
    validate_monotonic_word_timing(segments)
    _finalize_recovery_report(report, segments)
    return SyncPassResult(segments, report)


def _bounded_unmatched_order_matches(
    provider_words: list[dict[str, Any]],
    stable_words: list[dict[str, Any]],
    existing_matches: dict[int, int],
    *,
    boundary_tolerance: float,
) -> dict[int, int]:
    used_stable_indexes = set(existing_matches.values())
    matches: dict[int, int] = {}
    provider_groups: dict[str, list[int]] = {}
    for provider_index, word in enumerate(provider_words):
        group_id = str(word.get("alignmentGroupId") or "").strip()
        if not group_id:
            continue
        provider_groups.setdefault(group_id, []).append(provider_index)
    for _group_id, provider_indexes in provider_groups.items():
        unmatched_providers = [idx for idx in provider_indexes if idx not in existing_matches]
        if not unmatched_providers:
            continue
        candidate_stable = [
            stable_index
            for stable_index, stable_word in enumerate(stable_words)
            if stable_index not in used_stable_indexes
            and any(
                _stable_word_inside_provider_group(provider_words[provider_index], stable_word, tolerance=boundary_tolerance)
                for provider_index in provider_indexes
            )
        ]
        for provider_index, stable_index in zip(unmatched_providers, candidate_stable):
            if _stable_word_inside_provider_group(provider_words[provider_index], stable_words[stable_index], tolerance=boundary_tolerance):
                matches[provider_index] = stable_index
                used_stable_indexes.add(stable_index)
    return matches


def apply_stable_refinement(
    segments: list[dict[str, Any]],
    audio_path: str,
    language_mode: str,
    config: dict[str, Any] | None = None,
) -> SyncPassResult:
    config = config or {}
    resolved_config = resolved_stable_ts_config(config)
    enabled = bool(resolved_config["stableTsEnabled"])
    speech_ranges = config.get("speechRanges") if isinstance(config.get("speechRanges"), list) else None
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
        "errorCategory": None,
        "cacheDir": _stable_ts_cache_dir(),
        "warnings": [],
        "boundaryRejectedWords": 0,
        "missingAlignmentGroupWords": 0,
        "resolvedConfiguration": resolved_config,
        "perGroup": [],
        "failedGroupIds": [],
        "recoveryByGroup": {},
        "verifiedWordCount": 0,
        "estimatedWordCount": 0,
        "phraseFallbackCueCount": 0,
        "finalTimingQualityMode": "unusable",
    }
    next_segments = ensure_alignment_groups(copy.deepcopy(segments))
    if not enabled:
        base_report["reason"] = "ENABLE_STABLE_TS is false"
        return _recover_all_segments(next_segments, base_report, "stable_ts_disabled", speech_ranges=speech_ranges)
    if not stable_ts_available():
        base_report["reason"] = "stable-ts is not installed"
        base_report["errorCategory"] = "stable_ts_not_installed"
        return _recover_all_segments(next_segments, base_report, "stable_ts_not_installed", speech_ranges=speech_ranges)
    if not _cache_dir_writable(str(base_report["cacheDir"])):
        base_report["reason"] = "stable-ts model cache is not writable"
        base_report["errorCategory"] = "stable_ts_cache_not_writable"
        return _recover_all_segments(next_segments, base_report, "stable_ts_cache_not_writable", speech_ranges=speech_ranges)

    rows = _flatten_provider_words(next_segments)
    provider_words = [row[2] for row in rows]
    base_report["providerWordCount"] = len(provider_words)
    if not provider_words:
        base_report["reason"] = "no provider words"
        return _recover_all_segments(next_segments, base_report, "no_provider_words", speech_ranges=speech_ranges)

    model_name = str(config.get("model") or os.getenv("STABLE_TS_MODEL", "base") or "base")
    device = str(config.get("device") or os.getenv("STABLE_TS_DEVICE", "auto") or "auto")
    resolved_device = _resolve_device(device)
    base_report["model"] = model_name
    base_report["device"] = resolved_device
    max_audio_seconds = float(config.get("maxAudioSeconds") or 45.0)
    audio_duration = _optional_float(config.get("audioDurationSeconds"))
    if audio_duration is None:
        audio_duration = _audio_duration_seconds(audio_path)
    if audio_duration is not None:
        base_report["audioDurationSeconds"] = round(audio_duration, 3)
    base_report["maxAudioSeconds"] = round(max_audio_seconds, 3)
    if resolved_device == "cpu" and audio_duration is not None and audio_duration > max_audio_seconds:
        base_report["reason"] = (
            f"stable-ts CPU alignment skipped for {audio_duration:.1f}s audio above "
            f"{max_audio_seconds:.1f}s configured limit"
        )
        base_report["errorCategory"] = "stable_ts_audio_too_long_for_cpu"
        return _recover_all_segments(next_segments, base_report, "stable_ts_audio_too_long_for_cpu", speech_ranges=speech_ranges)

    semaphore_timeout_seconds = max(
        1.0,
        float(os.getenv("STABLE_TS_SEMAPHORE_TIMEOUT_SECONDS", "30") or 30),
    )
    acquired = _ALIGNMENT_SEMAPHORE.acquire(timeout=semaphore_timeout_seconds)
    if not acquired:
        base_report["reason"] = "stable-ts alignment timed out waiting for concurrency slot"
        base_report["errorCategory"] = "stable_ts_timeout"
        return _recover_all_segments(next_segments, base_report, "stable_ts_timeout", speech_ranges=speech_ranges)
    try:
        warnings: list[str] = []
        stable_words: list[dict[str, Any]] = []
        stable_mode = "forced_align"
        try:
            stable_words = force_align_provider_words(
                next_segments,
                audio_path,
                language_mode,
                model_name=model_name,
                device=device,
            )
        except Exception as exc:
            warnings.append(f"forced_align_failed:{type(exc).__name__}: {exc}")
            stable_words = []

        if not stable_words:
            stable_mode = "transcribe"
            try:
                stable_words = transcribe_stable_words(
                    audio_path,
                    language_mode,
                    model_name=model_name,
                    device=device,
                )
            except Exception as exc:
                base_report["reason"] = "stable-ts failed"
                base_report["errorCategory"] = _classify_stable_ts_exception(exc)
                base_report["warnings"] = [*warnings, f"transcribe_failed:{type(exc).__name__}: {exc}"]
                return _recover_all_segments(next_segments, base_report, "stable_ts_failed", speech_ranges=speech_ranges)

        if warnings:
            base_report["warnings"] = warnings
    finally:
        _ALIGNMENT_SEMAPHORE.release()

    boundary_tolerance = float(config.get("boundaryToleranceSeconds") or _float_env("STABLE_TS_BOUNDARY_TOLERANCE_SECONDS", 0.08))
    match = match_stable_words_to_provider_words(
        provider_words,
        stable_words,
        boundary_tolerance=boundary_tolerance,
        require_alignment_groups=True,
    )
    base_report.update({k: v for k, v in match.items() if k != "matches"})
    if int(match.get("missingAlignmentGroupWords") or 0) > 0:
        base_report.setdefault("warnings", []).append(
            f"missing alignmentGroupId on {int(match.get('missingAlignmentGroupWords') or 0)} provider word(s)"
        )
    base_report["mode"] = stable_mode
    min_coverage = float(resolved_config["stableTsMinMatchCoverage"])
    min_ratio = float(resolved_config["stableTsMinWordRatio"])
    max_ratio = float(resolved_config["stableTsMaxWordRatio"])
    source = "stable_ts_forced_align" if stable_mode == "forced_align" else "stable_ts_adjusted"
    applied_words = 0
    rejected_reasons: list[str] = []

    for segment in next_segments:
        group_words = [word for word in segment.get("words") or [] if isinstance(word, dict)]
        if not group_words:
            recovery_source = _recover_segment(segment, "no_provider_words_in_group", speech_ranges=speech_ranges)
            _record_group_recovery(base_report, segment, reason="no_provider_words_in_group", recovery_source=recovery_source, accepted=False)
            continue
        group_window = _segment_window(segment)
        group_stable_words = _stable_words_for_window(stable_words, group_window, boundary_tolerance)
        group_match = match_stable_words_to_provider_words(
            group_words,
            group_stable_words,
            boundary_tolerance=boundary_tolerance,
            require_alignment_groups=False,
        )
        group_ratio = float(group_match.get("wordRatio") or 0.0)
        group_coverage = float(group_match.get("matchCoverage") or 0.0)
        group_accepted = (
            group_ratio >= min_ratio
            and group_ratio <= max_ratio
            and group_coverage >= min_coverage
            and bool(group_match.get("matches"))
        )
        if group_accepted:
            applied = _apply_group_stable_matches(
                segment,
                group_stable_words,
                group_match["matches"],
                source,
                boundary_tolerance=boundary_tolerance,
            )
            group_accepted = applied > 0
            applied_words += applied
        if group_accepted:
            for word in group_words:
                if word.get("timingQualityMode"):
                    continue
                word["timingQualityMode"] = "word_timed_estimated"
                word["alignmentRecoverySource"] = "provider_segment_interpolation"
                word["timingNeedsReview"] = True
                word["timingReviewRequired"] = True
            _record_group_recovery(
                base_report,
                segment,
                reason="token match timing transfer",
                recovery_source=source,
                match=group_match,
                accepted=True,
            )
            continue

        reason = "word ratio %.3f outside allowed range" % group_ratio
        if min_ratio <= group_ratio <= max_ratio:
            reason = f"token coverage {group_coverage:.3f} below threshold"
        rejected_reasons.append(reason)
        for word in group_words:
            word["stableTsRejectedReason"] = reason
        recovery_source = _recover_segment(segment, reason, speech_ranges=speech_ranges)
        _record_group_recovery(
            base_report,
            segment,
            reason=reason,
            recovery_source=recovery_source,
            match=group_match,
            accepted=False,
        )

    stable_transfer_diagnostics: dict[str, Any] = {}
    rolled_back = _rollback_invalid_stable_groups(rows, stable_transfer_diagnostics)
    validate_monotonic_word_timing(next_segments)
    final_applied_count = max(0, applied_words - rolled_back)
    base_report.update({
        "applied": final_applied_count > 0,
        "appliedWords": final_applied_count,
        "boundaryRejectedWords": sum(1 for word in provider_words if word.get("timingRepairReason") == "stable_ts_cross_boundary_rejected"),
        "orderFallbackUsed": False,
        "orderFallbackAppliedWords": 0,
        "reason": "per-group stable-ts transfer with local recovery"
        if final_applied_count
        else (rejected_reasons[0] if rejected_reasons else "stable-ts produced no accepted local groups"),
        **stable_transfer_diagnostics,
    })
    if rejected_reasons:
        base_report.setdefault("warnings", []).extend(sorted(set(rejected_reasons))[:10])
    _finalize_recovery_report(base_report, next_segments)
    return SyncPassResult(next_segments, base_report)
