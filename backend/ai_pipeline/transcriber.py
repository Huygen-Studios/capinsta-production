import os
import logging
import json
import asyncio
import base64
import re
import wave
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
    "auto": None,
    "auto_mixed_indian": None,
}

SARVAM_LANGUAGE_CODES = {
    "english": "en-IN",
    "hindi": "hi-IN",
    "hinglish": "hi-IN",
    "telugu": "te-IN",
    "telgish": "te-IN",
    "auto": "te-IN",
    "auto_mixed_indian": "te-IN",
}

SARVAM_URL = "https://api.sarvam.ai/speech-to-text"
GEMINI_MODEL = os.getenv("GEMINI_TRANSCRIPTION_MODEL", "gemini-3.5-flash").strip() or "gemini-3.5-flash"
GEMINI_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


SUPPORTED_STT_PROVIDERS = {"auto", "whisper", "groq_whisper", "openai_whisper", "sarvam", "gemini"}
DEFAULT_STT_PROVIDER_ORDER = ("gemini", "sarvam", "groq_whisper", "openai_whisper")
OPENAI_KEY_ERROR = "OpenAI API key is invalid or missing. Update OPENAI_API_KEY in the backend environment, then restart the server."
SARVAM_KEY_ERROR = "Sarvam API key is invalid or missing. Update SARVAM_API_KEY in the backend environment, then restart the server."
GROQ_KEY_ERROR = "Groq API key is invalid or missing. Update GROQ_API_KEY in the backend environment, then restart the server."
GEMINI_KEY_ERROR = "Gemini API key is invalid or missing. Update GEMINI_API_KEY in the backend environment, then restart the server."


class TranscriptionProviderError(RuntimeError):
    def __init__(self, provider: str, category: str, message: str | None = None, status: int | None = None):
        self.provider = provider
        self.category = category
        self.status = status
        safe_message = message or category
        super().__init__(safe_message)


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


def _normalize_provider_name(provider: str | None) -> str:
    normalized = (provider or "").strip().lower().replace("-", "_")
    if normalized == "groq" or normalized == "whisper":
        return "groq_whisper"
    if normalized == "openai":
        return "openai_whisper"
    return normalized


def _provider_order() -> list[str]:
    raw = os.getenv("STT_PROVIDER_ORDER", ",".join(DEFAULT_STT_PROVIDER_ORDER))
    ordered: list[str] = []
    for value in raw.split(","):
        provider = _normalize_provider_name(value)
        if provider and provider in SUPPORTED_STT_PROVIDERS and provider != "auto" and provider not in ordered:
            ordered.append(provider)
    return ordered or list(DEFAULT_STT_PROVIDER_ORDER)


def _has_real_key(env_name: str) -> bool:
    value = (os.environ.get(env_name) or "").strip()
    return bool(value and not value.startswith("your_") and "placeholder" not in value.lower())


def _provider_key_available(provider: str) -> bool:
    if provider == "gemini":
        return _has_real_key("GEMINI_API_KEY") or _has_real_key("GOOGLE_API_KEY")
    if provider == "sarvam":
        return _has_real_key("SARVAM_API_KEY")
    if provider == "groq_whisper":
        return _has_real_key("GROQ_API_KEY")
    if provider == "openai_whisper":
        return _has_real_key("OPENAI_API_KEY")
    return False


def _configured_provider_sequence() -> list[str]:
    provider = get_stt_provider()
    if provider != "auto":
        return [provider]
    return _provider_order()


def _resolve_provider(language_mode: str, requested_provider: str | None = None) -> str:
    provider = _normalize_provider_name(requested_provider or get_stt_provider())

    if provider != "auto":
        return provider

    for candidate in _provider_order():
        if _provider_key_available(candidate):
            return candidate
    raise RuntimeError("Configure GEMINI_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, or SARVAM_API_KEY for transcription.")


def validate_transcription_config(language_mode: str) -> None:
    language_mode = normalize_language_mode(language_mode)
    providers = _configured_provider_sequence()
    if get_stt_provider() == "auto":
        if any(_provider_key_available(provider) for provider in providers):
            return
        raise RuntimeError("Configure GEMINI_API_KEY, SARVAM_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY for transcription.")
    provider = providers[0]

    if provider == "sarvam":
        if not _has_real_key("SARVAM_API_KEY"):
            if language_mode in {"telgish", "auto_mixed_indian"}:
                raise RuntimeError(TELUGU_CAPABLE_PROVIDER_ERROR)
            raise RuntimeError("STT_PROVIDER=sarvam requires SARVAM_API_KEY.")
        return

    if provider == "gemini":
        if _has_real_key("GEMINI_API_KEY") or _has_real_key("GOOGLE_API_KEY"):
            return
        raise RuntimeError("STT_PROVIDER=gemini requires GEMINI_API_KEY.")

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


def _audio_duration_seconds(audio_path: str) -> float | None:
    try:
        with wave.open(audio_path, "rb") as audio:
            frames = audio.getnframes()
            rate = audio.getframerate()
            if frames > 0 and rate > 0:
                return frames / float(rate)
    except Exception:
        return None
    return None


def _looks_like_auth_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(token in text for token in ("invalid_api_key", "invalid api key", "incorrect api key", "unauthorized", "401", "403"))


def _failure_category(exc: Exception) -> tuple[str, int | None]:
    if isinstance(exc, TranscriptionProviderError):
        return exc.category, exc.status
    if isinstance(exc, requests.Timeout):
        return "timeout", None
    if isinstance(exc, requests.ConnectionError):
        return "connection", None
    if _looks_like_auth_error(exc):
        return "authentication", None
    text = str(exc).lower()
    if "429" in text or "quota" in text or "rate limit" in text or "rate_limit" in text:
        return "rate_limit", 429
    if "json" in text or "malformed" in text:
        return "malformed_response", None
    if "timestamp" in text or "word" in text:
        return "invalid_timestamps", None
    return "provider_error", None


def _validate_transcription_result(result: dict, provider: str, audio_path: str) -> dict:
    text = str(result.get("text") or "").strip()
    if not text:
        raise TranscriptionProviderError(provider, "empty_transcript", "empty transcript")

    duration = _as_timing_float(result.get("duration")) or _audio_duration_seconds(audio_path)
    words = result.get("words") or []
    if not isinstance(words, list) or not words:
        raise TranscriptionProviderError(provider, "invalid_timestamps", "missing word timestamps")

    valid_words: list[dict[str, Any]] = []
    last_start = -0.001
    last_end = -0.001
    max_reasonable_end = (duration + 5.0) if duration is not None else None
    for raw_word in words:
        if not isinstance(raw_word, dict):
            continue
        word = str(raw_word.get("word") or raw_word.get("text") or "").strip()
        start = _as_timing_float(raw_word.get("start"))
        end = _as_timing_float(raw_word.get("end"))
        if not word or start is None or end is None or end <= start:
            continue
        if start + 0.001 < last_start or end + 0.001 < last_end:
            raise TranscriptionProviderError(provider, "invalid_timestamps", "non-monotonic word timestamps")
        if max_reasonable_end is not None and end > max_reasonable_end:
            raise TranscriptionProviderError(provider, "invalid_timestamps", "word timestamps exceed audio duration")
        valid_words.append(raw_word)
        last_start = start
        last_end = end

    transcript_word_count = max(1, len(text.split()))
    coverage = len(valid_words) / transcript_word_count
    if len(valid_words) < 1 or (transcript_word_count >= 4 and coverage < 0.5):
        raise TranscriptionProviderError(provider, "invalid_timestamps", "insufficient word timestamp coverage")

    result["words"] = valid_words
    if duration is not None:
        result["duration"] = result.get("duration") or duration
    return result


def _gemini_api_key() -> str:
    gemini_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    google_key = (os.environ.get("GOOGLE_API_KEY") or "").strip()
    if gemini_key and google_key:
        logger.warning("Both GEMINI_API_KEY and GOOGLE_API_KEY are configured; using GEMINI_API_KEY.")
    return gemini_key or google_key


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


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            raise
        payload = json.loads(match.group(0))
    if not isinstance(payload, dict):
        raise ValueError("Gemini response JSON must be an object.")
    return payload


def _normalize_gemini_words(payload: dict[str, Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    raw_words = payload.get("words") or []
    if not isinstance(raw_words, list):
        return normalized

    for raw_word in raw_words:
        if not isinstance(raw_word, dict):
            continue
        text = str(raw_word.get("word") or raw_word.get("text") or "").strip()
        start = _as_timing_float(raw_word.get("start"))
        end = _as_timing_float(raw_word.get("end"))
        if not text or start is None or end is None:
            continue
        if end <= start:
            end = start + 0.02
        normalized.append(
            {
                "word": text,
                "start": round(max(0.0, start), 3),
                "end": round(max(start + 0.02, end), 3),
                "score": _as_timing_float(raw_word.get("confidence")) or 0.0,
                "confidence": _as_timing_float(raw_word.get("confidence")),
                "provider": "gemini",
                "timing_source": "provider_word",
            }
        )

    return normalized


def _call_gemini(audio_path: str, language_mode: str) -> dict:
    api_key = _gemini_api_key()
    if not api_key:
        raise RuntimeError("STT_PROVIDER=gemini requires GEMINI_API_KEY.")

    with open(audio_path, "rb") as file:
        audio_b64 = base64.b64encode(file.read()).decode("ascii")

    prompt = (
        "Transcribe this audio and return high-precision word timing alignment. "
        f"Language mode: {language_mode}. "
        "Return only valid JSON shaped as "
        '{"text":"full transcript","language":"detected language","words":[{"word":"token","start":0.000,"end":0.250,"confidence":0.0}]}. '
        "Use seconds from the start of this audio file. Include every spoken word in order."
    )
    response = requests.post(
        GEMINI_URL_TEMPLATE.format(model=GEMINI_MODEL),
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
        },
        json={
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": "audio/wav", "data": audio_b64}},
                    ],
                }
            ],
            "generationConfig": {
                "temperature": 0,
                "response_mime_type": "application/json",
            },
        },
        timeout=180,
    )

    if response.status_code >= 400:
        try:
            payload = response.json()
            error = payload.get("error") or {}
            provider_code = error.get("status") or error.get("code")
        except (ValueError, json.JSONDecodeError):
            provider_code = None

        if response.status_code in {401, 403} or str(provider_code).lower() in {"unauthenticated", "permission_denied", "invalid_api_key"}:
            raise TranscriptionProviderError("gemini", "authentication", GEMINI_KEY_ERROR, response.status_code)
        if response.status_code == 429:
            raise TranscriptionProviderError("gemini", "rate_limit", "Gemini transcription rate or quota limit exceeded.", response.status_code)
        if response.status_code >= 500:
            raise TranscriptionProviderError("gemini", "server_error", "Gemini transcription service returned a server error.", response.status_code)
        raise TranscriptionProviderError("gemini", "provider_error", "Gemini transcription failed.", response.status_code)

    try:
        payload = response.json()
    except (ValueError, json.JSONDecodeError) as exc:
        raise TranscriptionProviderError("gemini", "malformed_response", "Gemini returned invalid JSON.") from exc
    candidates = payload.get("candidates") or []
    parts = (((candidates[0] or {}).get("content") or {}).get("parts") or []) if candidates else []
    text_response = "\n".join(str(part.get("text") or "") for part in parts if isinstance(part, dict)).strip()
    if not text_response:
        raise TranscriptionProviderError("gemini", "empty_transcript", "Gemini transcription returned an empty response.")

    try:
        transcript_payload = _extract_json_object(text_response)
    except (ValueError, json.JSONDecodeError) as exc:
        raise TranscriptionProviderError("gemini", "malformed_response", "Gemini returned malformed transcript JSON.") from exc
    return {
        "text": (transcript_payload.get("text") or "").strip(),
        "language": transcript_payload.get("language"),
        "duration": transcript_payload.get("duration"),
        "segments": transcript_payload.get("segments") if isinstance(transcript_payload.get("segments"), list) else [],
        "words": _normalize_gemini_words(transcript_payload),
        "provider": "gemini",
        "model": GEMINI_MODEL,
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

    providers = _configured_provider_sequence()
    failures: list[tuple[str, str, int | None]] = []
    attempted: list[str] = []

    for attempt, provider in enumerate(providers, start=1):
        if not _provider_key_available(provider):
            failures.append((provider, "missing_key", None))
            logger.warning(
                "transcription_provider_failed provider=%s category=missing_key",
                provider,
            )
            continue

        logger.info(
            "transcription_provider_attempt provider=%s attempt=%s",
            provider,
            attempt,
        )
        try:
            result = _call_provider(provider, audio_path, normalized_mode)
            normalized = _normalize_provider_result(result, provider)
            validated = _validate_transcription_result(normalized, provider, audio_path)
            if attempted:
                validated["fallback"] = True
                validated["fallback_from"] = attempted.copy()
            logger.info(
                "transcription_provider_succeeded provider=%s fallback_from=%s",
                provider,
                ",".join(attempted),
            )
            return validated
        except Exception as exc:
            category, status = _failure_category(exc)
            failures.append((provider, category, status))
            attempted.append(provider)
            logger.warning(
                "transcription_provider_failed provider=%s category=%s%s",
                provider,
                category,
                f" status={status}" if status else "",
            )

    summary = ", ".join(
        f"{provider}({category})" for provider, category, _status in failures
    )
    raise RuntimeError(f"All configured transcription providers failed: {summary}.")


def _call_provider(provider: str, audio_path: str, normalized_mode: str) -> dict:
    if provider == "gemini":
        return _call_gemini(audio_path, normalized_mode)
    if provider == "sarvam":
        return _call_sarvam(audio_path, normalized_mode)
    if provider == "openai_whisper":
        return _call_openai_whisper(audio_path, normalized_mode)
    if provider == "groq_whisper":
        return transcribe_chunk_with_retry(audio_path, language=normalized_mode)
    raise TranscriptionProviderError(provider, "unsupported_provider", "Unsupported transcription provider.")


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
