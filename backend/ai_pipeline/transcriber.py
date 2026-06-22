import os
import logging
import json
import asyncio
from typing import Any

import requests
from groq import Groq
from openai import OpenAI
from .retry import with_retry
from .config import (
    RETRY_GROQ, WHISPER_PROMPTS,
    WEAK_SEGMENT_LOGPROB, WEAK_SEGMENT_NOSPEECH, RETRANSCRIBE_WEAK
)
from .language_modes import (
    CODE_MIXED_LANGUAGE_MODES,
    TELUGU_CAPABLE_PROVIDER_ERROR,
    normalize_language_mode,
)

logger = logging.getLogger(__name__)

LANGUAGE_HINTS = {
    "english": "en",
    "en": "en",
    "hindi": "hi",
    "hi": "hi",
    "hinglish": "hi",
    "telgish": "te",
    "teluglish": "te",
    "telugu": "te",
    "auto_mixed_indian": None,
}

SARVAM_LANGUAGE_CODES = {
    "english": "en-IN",
    "hinglish": "hi-IN",
    "telgish": "te-IN",
    "auto_mixed_indian": "te-IN",
}

SARVAM_URL = "https://api.sarvam.ai/speech-to-text"


SUPPORTED_STT_PROVIDERS = {"auto", "whisper", "groq_whisper", "openai_whisper", "sarvam"}
OPENAI_KEY_ERROR = "OpenAI API key is invalid or missing. Update OPENAI_API_KEY in the backend environment, then restart the server."
SARVAM_KEY_ERROR = "Sarvam API key is invalid or missing. Update SARVAM_API_KEY in the backend environment, then restart the server."
GROQ_KEY_ERROR = "Groq API key is invalid or missing. Update GROQ_API_KEY in the backend environment, then restart the server."


def get_stt_provider() -> str:
    provider = os.environ.get("STT_PROVIDER", "auto").strip().lower()
    provider = provider.replace("-", "_")
    if provider in {"groq", "groq_whisper", "whisper"}:
        return "groq_whisper" if provider != "auto" else "auto"
    if provider == "openai":
        return "openai_whisper"
    if provider not in SUPPORTED_STT_PROVIDERS:
        allowed = ", ".join(sorted(SUPPORTED_STT_PROVIDERS))
        raise RuntimeError(f"STT_PROVIDER must be one of: {allowed}.")
    return provider


def _has_real_key(env_name: str) -> bool:
    value = (os.environ.get(env_name) or "").strip()
    return bool(value and not value.startswith("your_") and "placeholder" not in value.lower())


def _resolve_provider(language_mode: str, requested_provider: str | None = None) -> str:
    mode = normalize_language_mode(language_mode)
    provider = (requested_provider or get_stt_provider()).strip().lower().replace("-", "_")
    if provider == "whisper":
        provider = "groq_whisper"
    if provider == "groq":
        provider = "groq_whisper"
    if provider == "openai":
        provider = "openai_whisper"

    if provider != "auto":
        return provider

    if mode in CODE_MIXED_LANGUAGE_MODES:
        if _has_real_key("SARVAM_API_KEY"):
            return "sarvam"
        if _has_real_key("OPENAI_API_KEY"):
            return "openai_whisper"
        if _has_real_key("GROQ_API_KEY"):
            return "groq_whisper"
        raise RuntimeError(TELUGU_CAPABLE_PROVIDER_ERROR)

    if _has_real_key("GROQ_API_KEY"):
        return "groq_whisper"
    if _has_real_key("OPENAI_API_KEY"):
        return "openai_whisper"
    if _has_real_key("SARVAM_API_KEY"):
        return "sarvam"
    raise RuntimeError("Configure GROQ_API_KEY, OPENAI_API_KEY, or SARVAM_API_KEY for transcription.")


def validate_transcription_config(language_mode: str) -> None:
    language_mode = normalize_language_mode(language_mode)
    provider = _resolve_provider(language_mode)

    if provider == "sarvam":
        if not _has_real_key("SARVAM_API_KEY"):
            if language_mode in {"telgish", "auto_mixed_indian"}:
                raise RuntimeError(TELUGU_CAPABLE_PROVIDER_ERROR)
            raise RuntimeError("STT_PROVIDER=sarvam requires SARVAM_API_KEY.")
        return

    if provider == "openai_whisper":
        if not _has_real_key("OPENAI_API_KEY"):
            if language_mode in {"telgish", "auto_mixed_indian"}:
                raise RuntimeError(TELUGU_CAPABLE_PROVIDER_ERROR)
            raise RuntimeError("STT_PROVIDER=openai_whisper requires OPENAI_API_KEY.")
        return

    if not _has_real_key("GROQ_API_KEY"):
        if language_mode in {"telgish", "auto_mixed_indian"}:
            raise RuntimeError(TELUGU_CAPABLE_PROVIDER_ERROR)
        raise RuntimeError("STT_PROVIDER=groq_whisper requires GROQ_API_KEY.")


def resolved_stt_provider(language_mode: str) -> str:
    return _resolve_provider(normalize_language_mode(language_mode))


def _as_timing_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _looks_like_auth_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(token in text for token in ("invalid_api_key", "invalid api key", "incorrect api key", "unauthorized", "401", "403"))


def _normalize_provider_result(result: dict, provider: str) -> dict:
    normalized_words: list[dict[str, Any]] = []
    for raw_word in result.get("words") or []:
        if not isinstance(raw_word, dict):
            continue
        text = str(raw_word.get("word") or raw_word.get("text") or "").strip()
        start = _as_timing_float(raw_word.get("start"))
        end = _as_timing_float(raw_word.get("end"))
        if not text or start is None or end is None:
            continue
        if end <= start:
            end = start + 0.02

        timing_source = str(raw_word.get("timingSource") or raw_word.get("timing_source") or "provider_word")
        normalized_word = {
            **raw_word,
            "word": text,
            "start": round(max(0.0, start), 3),
            "end": round(max(start + 0.02, end), 3),
            "provider": raw_word.get("provider") or provider,
            "timing_source": timing_source,
            "timingSource": timing_source,
        }
        normalized_words.append(normalized_word)

    result["words"] = normalized_words
    result["provider"] = result.get("provider") or provider
    return result


def _call_groq(client, audio_path: str, prompt: str, language_hint: str | None,
               temperature: float = 0.0) -> dict:
    """Single Groq Whisper call returning normalized dict."""
    with open(audio_path, "rb") as file:
        kwargs = {
            "file": (audio_path, file.read()),
            "model": "whisper-large-v3",
            "response_format": "verbose_json",
            "timestamp_granularities": ["word", "segment"],
            "temperature": temperature,
        }
        if prompt:
            kwargs["prompt"] = prompt
        if language_hint:
            kwargs["language"] = language_hint

        try:
            transcription = client.audio.transcriptions.create(**kwargs)
        except Exception as exc:
            if _looks_like_auth_error(exc):
                raise RuntimeError(GROQ_KEY_ERROR) from exc
            raise

    if hasattr(transcription, "model_dump"):
        payload = transcription.model_dump()
    elif isinstance(transcription, dict):
        payload = transcription
    else:
        payload = {"text": str(transcription).strip()}

    return {
        "text": (payload.get("text") or "").strip(),
        "language": payload.get("language"),
        "duration": payload.get("duration"),
        "segments": payload.get("segments") or [],
        "words": payload.get("words") or [],
        "provider": "groq_whisper",
    }


def _call_openai_whisper(audio_path: str, language_mode: str) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("STT_PROVIDER=openai_whisper requires OPENAI_API_KEY.")

    client = OpenAI(api_key=api_key)
    language_hint = LANGUAGE_HINTS.get(language_mode)
    prompt = WHISPER_PROMPTS.get(language_mode, "")

    with open(audio_path, "rb") as file:
        kwargs: dict[str, Any] = {
            "file": file,
            "model": "whisper-1",
            "response_format": "verbose_json",
            "timestamp_granularities": ["word", "segment"],
        }
        if language_hint:
            kwargs["language"] = language_hint
        if prompt:
            kwargs["prompt"] = prompt
        try:
            transcription = client.audio.transcriptions.create(**kwargs)
        except Exception as exc:
            if _looks_like_auth_error(exc):
                raise RuntimeError(OPENAI_KEY_ERROR) from exc
            raise

    if hasattr(transcription, "model_dump"):
        payload = transcription.model_dump()
    elif isinstance(transcription, dict):
        payload = transcription
    else:
        payload = {"text": str(transcription).strip()}

    return {
        "text": (payload.get("text") or "").strip(),
        "language": payload.get("language"),
        "duration": payload.get("duration"),
        "segments": payload.get("segments") or [],
        "words": payload.get("words") or [],
        "provider": "openai_whisper",
    }


def _normalize_sarvam_words(payload: dict[str, Any]) -> list[dict[str, Any]]:
    timestamps = payload.get("timestamps") or {}
    words = timestamps.get("words") or []
    starts = timestamps.get("start_time_seconds") or []
    ends = timestamps.get("end_time_seconds") or []
    normalized: list[dict[str, Any]] = []

    for i, word in enumerate(words):
        try:
            start = float(starts[i])
            end = float(ends[i])
        except (IndexError, TypeError, ValueError):
            continue
        if end <= start:
            continue
        normalized.append(
            {
                "word": str(word).strip(),
                "start": start,
                "end": end,
                "score": float(payload.get("language_probability") or 0.0),
                "provider": "sarvam",
                "timing_source": "provider_word",
            }
        )

    return normalized


def _call_sarvam(audio_path: str, language_mode: str) -> dict:
    api_key = os.environ.get("SARVAM_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("STT_PROVIDER=sarvam requires SARVAM_API_KEY.")

    language_code = SARVAM_LANGUAGE_CODES[language_mode]
    mode = "translit" if language_mode in CODE_MIXED_LANGUAGE_MODES else "transcribe"

    with open(audio_path, "rb") as file:
        response = requests.post(
            SARVAM_URL,
            headers={"api-subscription-key": api_key},
            data={
                "model": "saaras:v3",
                "mode": mode,
                "language_code": language_code,
                "with_timestamps": "true",
            },
            files={"file": (os.path.basename(audio_path), file, "audio/wav")},
            timeout=120,
        )

    if response.status_code >= 400:
        raw_detail = response.text[:500]
        try:
            payload = response.json()
            error = payload.get("error") or {}
            provider_message = error.get("message") or raw_detail
            provider_code = error.get("code")
        except (ValueError, json.JSONDecodeError):
            provider_message = raw_detail
            provider_code = None

        if response.status_code in {401, 403} or str(provider_code).lower() in {"invalid_api_key", "unauthorized"}:
            raise RuntimeError(SARVAM_KEY_ERROR)

        if response.status_code == 429:
            raise RuntimeError(
                "Sarvam transcription rate limit exceeded. Wait and try again, "
                "or switch STT_PROVIDER to openai_whisper/groq_whisper with a configured key. "
                f"Provider message: {provider_message}"
            )

        code_text = f" ({provider_code})" if provider_code else ""
        raise RuntimeError(f"Sarvam transcription failed ({response.status_code}{code_text}): {provider_message}")

    payload = response.json()
    return {
        "text": (payload.get("transcript") or "").strip(),
        "language": payload.get("language_code"),
        "duration": None,
        "segments": [],
        "words": _normalize_sarvam_words(payload),
        "provider": "sarvam",
        "request_id": payload.get("request_id"),
        "language_probability": payload.get("language_probability"),
    }


def _has_weak_segments(result: dict) -> bool:
    """Check if any segment has low confidence or high no-speech probability."""
    for seg in result.get("segments", []):
        logprob = seg.get("avg_logprob", 0.0)
        nospeech = seg.get("no_speech_prob", 0.0)
        if logprob is not None and logprob < WEAK_SEGMENT_LOGPROB:
            return True
        if nospeech is not None and nospeech > WEAK_SEGMENT_NOSPEECH:
            return True
    return False


def _merge_word_lists(primary: list, secondary: list) -> list:
    """Combine word lists, taking the longer/richer version."""
    if not primary:
        return secondary
    if not secondary:
        return primary
    # Pick whichever returned more words — more words = more recall
    return primary if len(primary) >= len(secondary) else secondary


@with_retry(max_retries=RETRY_GROQ)
def transcribe_chunk_with_retry(audio_path: str, language: str = "") -> dict:
    """Groq Whisper with double-pass on weak segments for maximum recall."""
    api_key = os.environ.get("GROQ_API_KEY", "dummy")
    client = Groq(api_key=api_key)

    prompt = WHISPER_PROMPTS.get(language, "")
    language_hint = LANGUAGE_HINTS.get(language)

    # Pass 1: deterministic decode (temperature=0)
    result = _call_groq(client, audio_path, prompt, language_hint, temperature=0.0)

    # Pass 2: if weak segments detected, re-transcribe with slight temperature
    # to catch words the deterministic pass missed
    if RETRANSCRIBE_WEAK and _has_weak_segments(result):
        logger.info(f"Weak segments detected in {audio_path}, running rescue pass...")
        try:
            rescue = _call_groq(client, audio_path, prompt, language_hint, temperature=0.2)
            # Take whichever has more text (more recall)
            if len(rescue["text"].split()) > len(result["text"].split()):
                logger.info(f"Rescue pass recovered more words: {len(rescue['text'].split())} vs {len(result['text'].split())}")
                result["text"] = rescue["text"]
                result["segments"] = rescue["segments"]
            # Always merge word lists for max coverage
            result["words"] = _merge_word_lists(result["words"], rescue["words"])
        except Exception as e:
            logger.warning(f"Rescue pass failed: {e}. Using first pass only.")

    return result


def transcribe_audio(audio_path: str, language_mode: str = "english") -> dict:
    """Provider abstraction for speech-to-text used by the pipeline."""
    normalized_mode = normalize_language_mode(language_mode)
    validate_transcription_config(normalized_mode)

    provider = _resolve_provider(normalized_mode)
    logger.info(
        "transcription_provider_selected provider=%s language_mode=%s audio_path=%s",
        provider,
        normalized_mode,
        os.path.basename(audio_path),
    )
    if provider == "sarvam":
        return _normalize_provider_result(_call_sarvam(audio_path, normalized_mode), provider)
    if provider == "openai_whisper":
        return _normalize_provider_result(_call_openai_whisper(audio_path, normalized_mode), provider)

    return _normalize_provider_result(transcribe_chunk_with_retry(audio_path, language=normalized_mode), provider)


async def transcribe_sarvam_chunks_bounded(
    audio_paths: list[str],
    language_mode: str,
    progress_callback=None,
) -> list[dict]:
    """Run blocking Sarvam REST calls concurrently with a strict upper bound."""
    normalized_mode = normalize_language_mode(language_mode)
    if _resolve_provider(normalized_mode) != "sarvam":
        return [
            transcribe_audio(audio_path, language_mode=normalized_mode)
            for audio_path in audio_paths
        ]
    try:
        concurrency = int(os.getenv("SARVAM_MAX_CONCURRENCY", "2"))
    except ValueError:
        concurrency = 2
    concurrency = max(1, min(concurrency, 8))
    semaphore = asyncio.Semaphore(concurrency)
    completed = 0
    completed_lock = asyncio.Lock()

    async def transcribe_one(index: int, audio_path: str) -> tuple[int, dict]:
        nonlocal completed
        async with semaphore:
            result = await asyncio.to_thread(
                transcribe_audio,
                audio_path,
                normalized_mode,
            )
        async with completed_lock:
            completed += 1
            if progress_callback:
                progress_callback(completed, len(audio_paths))
        return index, result

    logger.info(
        "sarvam_parallel_transcription chunks=%s concurrency=%s",
        len(audio_paths),
        concurrency,
    )
    indexed = await asyncio.gather(
        *(transcribe_one(index, path) for index, path in enumerate(audio_paths))
    )
    return [result for _, result in sorted(indexed, key=lambda item: item[0])]
