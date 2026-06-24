import os
import logging
import json
import asyncio
import base64
import re
import shutil
import subprocess
import tempfile
import wave
import time
from typing import Any

import requests
from google import genai
from google.genai import errors as genai_errors
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
    normalize_caption_output,
    normalize_language_mode,
)
try:
    from server.transcription_catalog import catalog_entry
    from server.transcription_control import coerce_snapshot
except Exception:  # pragma: no cover - direct script fallback
    catalog_entry = lambda provider, model: None
    coerce_snapshot = lambda value: None

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
    "auto": "unknown",
    "auto_mixed_indian": "unknown",
}

SARVAM_URL = "https://api.sarvam.ai/speech-to-text"
GEMINI_MODEL = os.getenv("GEMINI_TRANSCRIPTION_MODEL", "gemini-3.5-flash").strip() or "gemini-3.5-flash"
OPENAI_TRANSCRIPTION_MODEL = os.getenv("OPENAI_TRANSCRIPTION_MODEL", "whisper-1").strip() or "whisper-1"
GEMINI_INLINE_AUDIO_LIMIT_BYTES = 20 * 1024 * 1024


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


STT_PROVIDER_ATTEMPT_TIMEOUT_SECONDS = _env_int("STT_PROVIDER_ATTEMPT_TIMEOUT_SECONDS", 60, 5)


SUPPORTED_STT_PROVIDERS = {"auto", "whisper", "groq_whisper", "openai_whisper", "sarvam", "gemini"}
DEFAULT_STT_PROVIDER_ORDER = ("gemini", "sarvam", "groq_whisper", "openai_whisper")
OPENAI_KEY_ERROR = "OpenAI API key is invalid or missing. Update OPENAI_API_KEY in the backend environment, then restart the server."
SARVAM_KEY_ERROR = "Sarvam API key is invalid or missing. Update SARVAM_API_KEY in the backend environment, then restart the server."
GROQ_KEY_ERROR = "Groq API key is invalid or missing. Update GROQ_API_KEY in the backend environment, then restart the server."
GEMINI_KEY_ERROR = "Gemini API key is invalid or missing. Update GEMINI_API_KEY in the backend environment, then restart the server."


def _is_retryable_failure(category: str, status: int | None) -> bool:
    if status in {429, 500, 503, 504}:
        return True
    return category in {"rate_limited", "quota_exhausted", "provider_unavailable", "timeout", "connection_failed"}


class TranscriptionProviderError(RuntimeError):
    def __init__(
        self,
        provider: str,
        category: str,
        message: str | None = None,
        status: int | None = None,
        *,
        provider_code: str | None = None,
        request_id: str | None = None,
        retryable: bool | None = None,
    ):
        self.provider = provider
        self.category = category
        self.status = status
        self.provider_code = provider_code
        self.request_id = request_id
        self.retryable = retryable if retryable is not None else _is_retryable_failure(category, status)
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


def is_real_secret(value: str | None) -> bool:
    cleaned = (value or "").strip()
    if not cleaned:
        return False
    lowered = cleaned.lower()
    placeholder_tokens = (
        "placeholder",
        "your_api_key",
        "your api key",
        "your_",
        "real key",
        "remove it",
        "example",
        "changeme",
    )
    if cleaned.startswith("<") and cleaned.endswith(">"):
        return False
    if any(token in lowered for token in placeholder_tokens):
        return False
    if set(cleaned) <= {"."}:
        return False
    return True


def _has_real_key(env_name: str) -> bool:
    return is_real_secret(os.environ.get(env_name))


def _provider_key_available(provider: str) -> bool:
    if provider == "gemini":
        return _has_real_key("GEMINI_API_KEY") or _has_real_key("GOOGLE_API_KEY")
    if provider == "sarvam":
        return _has_real_key("SARVAM_API_KEY")
    if provider == "groq_whisper":
        return _has_real_key("GROQ_API_KEY")
    if provider in {"openai_whisper", "openai"}:
        return _has_real_key("OPENAI_API_KEY")
    return False


def _configured_provider_sequence() -> list[str]:
    provider = get_stt_provider()
    if provider != "auto":
        return [provider]
    return [candidate for candidate in _provider_order() if _provider_key_available(candidate)]


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
        if providers:
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
        return "connection_failed", None
    if _looks_like_auth_error(exc):
        return "authentication_failed", None
    text = str(exc).lower()
    if "429" in text or "quota" in text or "rate limit" in text or "rate_limit" in text:
        return "rate_limited", 429
    if "json" in text or "malformed" in text:
        return "structured_output_invalid", None
    if "timestamp" in text or "word" in text:
        return "timestamps_invalid", None
    return "unknown_provider_error", None


def _failure_summary(provider: str, category: str, status: int | None) -> str:
    if provider == "gemini":
        if category in {"authentication", "authentication_failed"}:
            detail = f"HTTP {status}, invalid Gemini API key" if status else "invalid Gemini API key"
            return f"gemini(authentication_failed: {detail})"
        if category in {"permission_or_blocked_key", "permission_denied"}:
            detail = f"HTTP {status}, API key blocked or permission denied" if status else "API key blocked or permission denied"
            return f"gemini(permission_denied: {detail})"
        if category in {"quota_or_rate_limit", "quota_exhausted", "rate_limited"}:
            return f"gemini({category}{f': HTTP {status}' if status else ''})"
        if category in {"endpoint_or_model_not_found", "model_not_found"}:
            return f"gemini(model_not_found{f': HTTP {status}' if status else ''})"
        if category == "invalid_request":
            return f"gemini(invalid_request{f': HTTP {status}' if status else ''})"
        if category == "provider_unavailable":
            return f"gemini(provider_unavailable{f': HTTP {status}' if status else ''})"
        if category in {"transport_error", "connection_failed"}:
            return f"gemini({category})"
        if category in {"response_error", "unknown_provider_error", "structured_output_invalid"}:
            return f"gemini({category})"
    return f"{provider}({category}{f': HTTP {status}' if status else ''})"


def _validate_transcription_result(
    result: dict,
    provider: str,
    audio_path: str,
    *,
    timestamp_strategy: str | None = None,
) -> dict:
    text = str(result.get("text") or "").strip()
    if not text:
        raise TranscriptionProviderError(provider, "empty_transcript", "empty transcript")

    duration = _as_timing_float(result.get("duration")) or _audio_duration_seconds(audio_path)
    words = result.get("words") or []
    if timestamp_strategy == "local_forced_alignment":
        if duration is not None:
            result["duration"] = result.get("duration") or duration
        result["words"] = words if isinstance(words, list) else []
        return result
    if not isinstance(words, list) or not words:
        raise TranscriptionProviderError(provider, "timestamps_missing", "missing word timestamps")

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
            raise TranscriptionProviderError(provider, "timestamps_invalid", "non-monotonic word timestamps")
        if max_reasonable_end is not None and end > max_reasonable_end:
            raise TranscriptionProviderError(provider, "timestamps_invalid", "word timestamps exceed audio duration")
        valid_words.append(raw_word)
        last_start = start
        last_end = end

    if len(valid_words) < 1:
        raise TranscriptionProviderError(provider, "timestamps_invalid", "no valid word timestamps")
    if provider != "sarvam":
        transcript_word_count = max(1, len(text.split()))
        coverage = len(valid_words) / transcript_word_count
        if transcript_word_count >= 4 and coverage < 0.5:
            raise TranscriptionProviderError(provider, "timestamps_invalid", "insufficient word timestamp coverage")

    result["words"] = valid_words
    if duration is not None:
        result["duration"] = result.get("duration") or duration
    return result


def _gemini_api_key() -> str:
    raw_key = os.getenv("GEMINI_API_KEY")
    gemini_key = raw_key.strip() if raw_key else None
    google_raw = os.getenv("GOOGLE_API_KEY")
    google_key = google_raw.strip() if google_raw else None
    if is_real_secret(gemini_key) and is_real_secret(google_key):
        logger.warning("Both GEMINI_API_KEY and GOOGLE_API_KEY are configured; GOOGLE_API_KEY is ignored for Gemini transcription.")
    if is_real_secret(gemini_key):
        return gemini_key or ""
    if is_real_secret(google_key):
        return google_key or ""
    return ""


def _gemini_client(api_key: str):
    return genai.Client(api_key=api_key)


GEMINI_SUPPORTED_AUDIO_MIME_TYPES = {"audio/wav", "audio/mpeg", "audio/flac", "audio/ogg", "audio/aac"}


def _sniff_audio_mime_type(audio_path: str) -> str | None:
    try:
        with open(audio_path, "rb") as file:
            header = file.read(64)
    except OSError:
        return None

    if len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE":
        return "audio/wav"
    if header.startswith(b"ID3") or (len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0):
        suffix = os.path.splitext(audio_path)[1].lower()
        return "audio/aac" if suffix in {".aac", ".adts"} else "audio/mpeg"
    if header.startswith(b"fLaC"):
        return "audio/flac"
    if header.startswith(b"OggS"):
        return "audio/ogg"
    return None


def _looks_like_mp4_container(audio_path: str) -> bool:
    try:
        with open(audio_path, "rb") as file:
            header = file.read(32)
    except OSError:
        return False
    return b"ftyp" in header[:16] or os.path.splitext(audio_path)[1].lower() in {".mp4", ".m4a", ".mov"}


def _audio_mime_type(audio_path: str) -> str:
    mime_type = _sniff_audio_mime_type(audio_path)
    if mime_type in GEMINI_SUPPORTED_AUDIO_MIME_TYPES:
        return mime_type
    if _looks_like_mp4_container(audio_path):
        raise TranscriptionProviderError(
            "gemini",
            "invalid_request",
            "unsupported audio container: extract or transcode to wav, mp3, flac, ogg, or aac before sending to Gemini",
        )
    raise TranscriptionProviderError(
        "gemini",
        "invalid_request",
        "unsupported or unreadable audio format: expected wav, mp3, flac, ogg, or aac",
    )


def _transcode_gemini_audio_to_wav(audio_path: str) -> str:
    ffmpeg = shutil.which(os.getenv("FFMPEG_PATH") or "ffmpeg")
    if not ffmpeg:
        raise TranscriptionProviderError(
            "gemini",
            "invalid_request",
            "unsupported audio format and ffmpeg is unavailable for safe Gemini transcoding",
        )

    fd, output_path = tempfile.mkstemp(prefix="capinsta-gemini-", suffix=".wav")
    os.close(fd)
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        audio_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        output_path,
    ]
    try:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30)
    except subprocess.TimeoutExpired as exc:
        try:
            os.remove(output_path)
        except OSError:
            pass
        raise TranscriptionProviderError("gemini", "timeout", "timed out preparing audio for Gemini") from exc
    except subprocess.CalledProcessError as exc:
        try:
            os.remove(output_path)
        except OSError:
            pass
        detail = (exc.stderr or b"").decode("utf-8", errors="replace").strip()
        safe_detail = detail.splitlines()[-1][:180] if detail else "ffmpeg could not extract audio"
        raise TranscriptionProviderError("gemini", "invalid_request", f"Gemini audio preparation failed: {safe_detail}") from exc
    return output_path


def _prepare_gemini_audio_file(audio_path: str) -> tuple[str, str, str | None]:
    try:
        return audio_path, _audio_mime_type(audio_path), None
    except TranscriptionProviderError as exc:
        if exc.category not in {"invalid_request"}:
            raise

    converted_path = _transcode_gemini_audio_to_wav(audio_path)
    mime_type = _audio_mime_type(converted_path)
    logger.info(
        "gemini_audio_transcoded provider=gemini source_supported=false target_mime_type=%s file_size=%s",
        mime_type,
        os.path.getsize(converted_path),
    )
    return converted_path, mime_type, converted_path


def _prepare_openai_audio_file(audio_path: str) -> tuple[str, str, str | None]:
    mime_type = _sniff_audio_mime_type(audio_path)
    if mime_type in GEMINI_SUPPORTED_AUDIO_MIME_TYPES:
        return audio_path, mime_type, None

    converted_path = _transcode_gemini_audio_to_wav(audio_path)
    logger.info(
        "openai_audio_transcoded provider=openai_whisper source_supported=false target_mime_type=audio/wav file_size=%s",
        os.path.getsize(converted_path),
    )
    return converted_path, "audio/wav", converted_path


def _sanitize_provider_message(message: str | None) -> str:
    text = str(message or "").strip()
    if not text:
        return ""
    text = re.sub(r"AIza[0-9A-Za-z_\-]{10,}", "[redacted]", text)
    text = re.sub(r"AQ\.[0-9A-Za-z_\-.]{10,}", "[redacted]", text)
    text = re.sub(r"key=[^&\s]+", "key=[redacted]", text, flags=re.IGNORECASE)
    return text[:300]


def _gemini_error_status(exc: Exception) -> int | None:
    for attr in ("code", "status_code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)

    response = getattr(exc, "response", None)
    if response is not None:
        value = getattr(response, "status_code", None) or getattr(response, "status", None)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)

    match = re.search(r"\b(400|401|403|404|429|5\d{2})\b", str(exc))
    if match:
        return int(match.group(1))
    return None


def _gemini_error_category(status: int | None) -> str:
    if status == 400:
        return "invalid_request"
    if status == 401:
        return "authentication_failed"
    if status == 403:
        return "permission_denied"
    if status == 404:
        return "model_not_found"
    if status == 429:
        return "rate_limited"
    if status and status >= 500:
        return "provider_unavailable"
    return "unknown_provider_error"


def _gemini_provider_code(exc: Exception) -> str | None:
    status_value = getattr(exc, "status", None)
    if isinstance(status_value, str) and status_value:
        return status_value
    details = getattr(exc, "details", None)
    if isinstance(details, dict):
        error = details.get("error")
        if isinstance(error, dict):
            code = error.get("status")
            return str(code) if code else None
        code = details.get("status")
        return str(code) if code else None
    return None


def _classify_gemini_error(exc: Exception) -> TranscriptionProviderError:
    if isinstance(exc, (TimeoutError, requests.Timeout)):
        return TranscriptionProviderError("gemini", "timeout", "Gemini request timed out.")
    if isinstance(exc, requests.ConnectionError):
        return TranscriptionProviderError("gemini", "connection_failed", "Gemini connection failed.")

    status = _gemini_error_status(exc)
    provider_code = _gemini_provider_code(exc)
    message = _sanitize_provider_message(getattr(exc, "message", None) or str(exc))
    category = _gemini_error_category(status)

    if status is not None:
        logger.warning(
            "gemini_request_failed provider=gemini model=%s status=%s google_code=%s message=%s",
            GEMINI_MODEL,
            status,
            provider_code or "-",
            message or "-",
        )
        return TranscriptionProviderError("gemini", category, message or category, status, provider_code=provider_code)

    if isinstance(exc, genai_errors.APIError):
        logger.warning(
            "gemini_request_failed provider=gemini model=%s status=%s google_code=%s message=%s",
            GEMINI_MODEL,
            status,
            provider_code or "-",
            message or "-",
        )
        return TranscriptionProviderError("gemini", category, message or category, status, provider_code=provider_code)

    logger.warning(
        "gemini_request_failed provider=gemini model=%s status=- google_code=- message=%s",
        GEMINI_MODEL,
        message or "-",
    )
    return TranscriptionProviderError("gemini", "unknown_provider_error", message or "Gemini response error.")


def _normalize_provider_result(result: dict, provider: str) -> dict:
    normalized_words: list[dict[str, Any]] = []
    timestamp_basis = str(result.get("timestamp_basis") or result.get("timestampBasis") or "chunk_local")
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
            "timestampBasis": raw_word.get("timestampBasis") or raw_word.get("timestamp_basis") or timestamp_basis,
        }
        normalized_words.append(normalized_word)

    result["words"] = normalized_words
    result["provider"] = result.get("provider") or provider
    result["timestamp_basis"] = timestamp_basis
    result["timestampBasis"] = timestamp_basis
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
        "timestamp_basis": "chunk_local",
    }


def _openai_transcription_request_kwargs(
    *,
    file: Any,
    filename: str,
    mime_type: str,
    model: str,
    language_hint: str | None,
    prompt: str,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "file": (filename, file, mime_type),
        "model": model,
        "temperature": 0,
        "timeout": STT_PROVIDER_ATTEMPT_TIMEOUT_SECONDS,
    }
    if model == "whisper-1":
        kwargs["response_format"] = "verbose_json"
        kwargs["timestamp_granularities"] = ["word", "segment"]
        if language_hint:
            kwargs["language"] = language_hint
        if prompt:
            kwargs["prompt"] = prompt
        return kwargs
    if model in {"gpt-4o-mini-transcribe", "gpt-4o-transcribe"}:
        kwargs["response_format"] = "json"
        if language_hint:
            kwargs["language"] = language_hint
        if prompt:
            kwargs["prompt"] = prompt
        return kwargs
    raise TranscriptionProviderError("openai", "unsupported_model", "Unsupported OpenAI transcription model.")


def _call_openai_whisper(audio_path: str, language_mode: str, transcription_config_snapshot: Any = None) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("STT_PROVIDER=openai_whisper requires OPENAI_API_KEY.")

    snapshot = coerce_snapshot(transcription_config_snapshot)
    model = snapshot.model if snapshot else OPENAI_TRANSCRIPTION_MODEL
    timeout_seconds = (snapshot.resolved_pipeline_options or {}).get("performance", {}).get("providerTimeoutSeconds") if snapshot else None
    client = OpenAI(
        api_key=api_key,
        timeout=int(timeout_seconds or STT_PROVIDER_ATTEMPT_TIMEOUT_SECONDS),
        max_retries=0,
    )
    language_hint = LANGUAGE_HINTS.get(language_mode)
    prompt = WHISPER_PROMPTS.get(language_mode, "")
    prepared_path, upload_mime_type, cleanup_path = _prepare_openai_audio_file(audio_path)

    try:
        size_bytes = os.path.getsize(prepared_path)
        logger.info(
            "openai_audio_input provider=openai_whisper model=%s mime_type=%s file_size=%s",
            model,
            upload_mime_type,
            size_bytes,
        )
        with open(prepared_path, "rb") as file:
            kwargs = _openai_transcription_request_kwargs(
                file=file,
                filename=os.path.basename(prepared_path),
                mime_type=upload_mime_type,
                model=model,
                language_hint=language_hint,
                prompt=prompt,
            )
            try:
                transcription = client.audio.transcriptions.create(**kwargs)
            except Exception as exc:
                if _looks_like_auth_error(exc):
                    raise RuntimeError(OPENAI_KEY_ERROR) from exc
                raise
    finally:
        if cleanup_path:
            try:
                os.remove(cleanup_path)
            except OSError:
                pass

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
        "provider": "openai" if snapshot else "openai_whisper",
        "model": model,
        "timestamp_strategy": "provider_word" if model == "whisper-1" else "local_forced_alignment",
        "timestamp_capability": "native_provider_word" if model == "whisper-1" else "transcript_text",
        "timestamp_basis": "chunk_local" if model == "whisper-1" else "none",
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


def _derive_words_for_segment(text: str, start: float, end: float, provider: str = "gemini") -> list[dict[str, Any]]:
    tokens = [token for token in re.split(r"\s+", text.strip()) if token]
    if not tokens:
        return []
    span = max(0.02, end - start)
    step = span / len(tokens)
    derived: list[dict[str, Any]] = []
    cursor = start
    for index, token in enumerate(tokens):
        word_start = cursor
        word_end = end if index == len(tokens) - 1 else min(end, start + step * (index + 1))
        if word_end <= word_start:
            word_end = min(end, word_start + 0.02)
        derived.append(
            {
                "word": token,
                "start": round(max(0.0, word_start), 3),
                "end": round(max(word_start + 0.001, word_end), 3),
                "provider": provider,
                "timing_source": "provider_segment_derived",
                "timingSource": "provider_segment_derived",
                "timestampBasis": "chunk_local",
            }
        )
        cursor = word_end
    return derived


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
                "timing_source": "provider_structured_word",
                "timingSource": "provider_structured_word",
                "timestampBasis": "chunk_local",
            }
        )

    return normalized


def _normalize_gemini_segments(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    segments: list[dict[str, Any]] = []
    all_words: list[dict[str, Any]] = []
    raw_segments = payload.get("segments") or []
    if not isinstance(raw_segments, list):
        raw_segments = []

    last_segment_end = -0.001
    for seg_index, raw_segment in enumerate(raw_segments):
        if not isinstance(raw_segment, dict):
            continue
        text = str(raw_segment.get("text") or "").strip()
        start = _as_timing_float(raw_segment.get("start"))
        end = _as_timing_float(raw_segment.get("end"))
        if not text or start is None or end is None:
            continue
        start = max(0.0, start)
        end = max(start + 0.02, end)
        if start + 0.001 < last_segment_end:
            raise TranscriptionProviderError("gemini", "timestamps_invalid", f"non-monotonic timestamp at segment {seg_index}")

        segment_words_payload = {"words": raw_segment.get("words") or []}
        segment_words = _normalize_gemini_words(segment_words_payload)
        in_segment_words: list[dict[str, Any]] = []
        last_word_end = start - 0.001
        
        has_valid_words = True
        if not segment_words:
            has_valid_words = False
        else:
            for word in segment_words:
                word_start = _as_timing_float(word.get("start"))
                word_end = _as_timing_float(word.get("end"))
                if word_start is None or word_end is None:
                    has_valid_words = False
                    break
                if word_start + 0.001 < start or word_end > end + 0.001 or word_start + 0.001 < last_word_end:
                    has_valid_words = False
                    break
                in_segment_words.append(word)
                last_word_end = word_end
                
        if not has_valid_words:
            in_segment_words = _derive_words_for_segment(text, start, end)

        segment = {
            **raw_segment,
            "start": round(start, 3),
            "end": round(end, 3),
            "text": text,
            "words": in_segment_words,
            "provider": "gemini",
        }
        segments.append(segment)
        all_words.extend(in_segment_words)
        last_segment_end = end

    if not segments:
        flat_words = _normalize_gemini_words(payload)
        text = str(payload.get("text") or "").strip()
        if flat_words and text:
            start = min(float(word["start"]) for word in flat_words)
            end = max(float(word["end"]) for word in flat_words)
            segments.append({"start": start, "end": end, "text": text, "words": flat_words, "provider": "gemini"})
            all_words.extend(flat_words)

    return segments, all_words


def _gemini_transcription_prompt(language_mode: str) -> str:
    return (
        "Transcribe this audio for Capinsta captions. "
        f"Spoken language hint: {language_mode}. "
        "Return only JSON with this exact shape: "
        '{"language":"detected language","segments":[{"start":0.0,"end":1.0,"text":"spoken words","words":[{"word":"spoken","start":0.0,"end":0.4}]}]}. '
        "Use seconds from the start of the audio. Include segment timestamps and word timestamps when you can align them reliably."
    )


GEMINI_TRANSCRIPTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "language": {"type": "string"},
        "segments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start": {"type": "number"},
                    "end": {"type": "number"},
                    "text": {"type": "string"},
                    "words": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "word": {"type": "string"},
                                "start": {"type": "number"},
                                "end": {"type": "number"},
                            },
                            "required": ["word", "start", "end"],
                        },
                    },
                },
                "required": ["start", "end", "text"],
            },
        },
    },
    "required": ["language", "segments"],
}


def _gemini_audio_input(client: Any, audio_path: str, *, model: str | None = None) -> dict[str, Any]:
    prepared_path, mime_type, cleanup_path = _prepare_gemini_audio_file(audio_path)
    try:
        size_bytes = os.path.getsize(prepared_path)
        logger.info(
            "gemini_audio_input provider=gemini model=%s mime_type=%s file_size=%s",
            model or GEMINI_MODEL,
            mime_type,
            size_bytes,
        )
        if size_bytes < GEMINI_INLINE_AUDIO_LIMIT_BYTES:
            with open(prepared_path, "rb") as file:
                return {
                    "type": "audio",
                    "data": base64.b64encode(file.read()).decode("utf-8"),
                    "mime_type": mime_type,
                }
        uploaded_file = client.files.upload(file=prepared_path, config={"mime_type": mime_type})
        return {
            "type": "audio",
            "uri": uploaded_file.uri,
            "mime_type": getattr(uploaded_file, "mime_type", None) or mime_type,
        }
    finally:
        if cleanup_path:
            try:
                os.remove(cleanup_path)
            except OSError:
                pass


def _call_gemini(audio_path: str, language_mode: str, transcription_config_snapshot: Any = None) -> dict:
    api_key = _gemini_api_key()
    if not api_key:
        raise RuntimeError("STT_PROVIDER=gemini requires GEMINI_API_KEY.")
    snapshot = coerce_snapshot(transcription_config_snapshot)
    model = snapshot.model if snapshot else GEMINI_MODEL
    client = _gemini_client(api_key)
    try:
        interaction = client.interactions.create(
            model=model,
            input=[
                {"type": "text", "text": _gemini_transcription_prompt(language_mode)},
                _gemini_audio_input(client, audio_path, model=model),
            ],
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": GEMINI_TRANSCRIPTION_SCHEMA,
            },
            timeout=STT_PROVIDER_ATTEMPT_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        raise _classify_gemini_error(exc) from exc

    text_response = getattr(interaction, "text", None)
    if text_response is None:
        text_response = getattr(interaction, "output_text", None)
    
    if not text_response and hasattr(interaction, "candidates") and interaction.candidates:
        candidate = interaction.candidates[0]
        if hasattr(candidate, "content") and hasattr(candidate.content, "parts") and candidate.content.parts:
            text_response = candidate.content.parts[0].text

    text_response = str(text_response or "").strip()
    
    logger.info("Gemini output preview: %r", text_response[:500])

    if not text_response:
        raise TranscriptionProviderError("gemini", "empty_transcript", "empty output_text")

    try:
        transcript_payload = _extract_json_object(text_response)
    except json.JSONDecodeError as exc:
        raise TranscriptionProviderError("gemini", "structured_output_invalid", f"invalid JSON at character {exc.pos}") from exc
    except ValueError as exc:
        raise TranscriptionProviderError("gemini", "structured_output_invalid", str(exc)) from exc

    if "segments" not in transcript_payload or not isinstance(transcript_payload["segments"], list) or not transcript_payload["segments"]:
        raise TranscriptionProviderError("gemini", "structured_output_invalid", "response schema mismatch: missing segments")

    try:
        segments, words = _normalize_gemini_segments(transcript_payload)
    except TranscriptionProviderError as exc:
        raise exc

    transcript_text = " ".join(str(segment.get("text") or "").strip() for segment in segments).strip()
    if not transcript_text:
        raise TranscriptionProviderError("gemini", "empty_transcript", "no transcript text exists")
        
    return {
        "text": transcript_text,
        "language": transcript_payload.get("language"),
        "duration": transcript_payload.get("duration"),
        "segments": segments,
        "words": words,
        "provider": "gemini",
        "model": model,
        "timestamp_strategy": "structured_word_validate",
        "timestamp_capability": "structured_model_word_timestamps",
        "timestamp_basis": "chunk_local",
    }


def _normalize_sarvam_words(payload: dict[str, Any]) -> list[dict[str, Any]]:
    timestamps = payload.get("timestamps") or {}
    if not isinstance(timestamps, dict):
        raise TranscriptionProviderError("sarvam", "timestamps_missing", "Sarvam timestamps object is missing")
    timing_granularity = "word"
    words = timestamps.get("words") or []
    if not words and timestamps.get("chunks"):
        words = timestamps.get("chunks") or []
        timing_granularity = "phrase"
    if not isinstance(words, list):
        raise TranscriptionProviderError("sarvam", "timestamps_invalid", "Sarvam timestamp words must be a list")
    preserve_phrase_timing = timing_granularity == "phrase" and len(words) > 1
    starts = timestamps.get("start_time_seconds") or []
    ends = timestamps.get("end_time_seconds") or []
    if not isinstance(starts, list) or not isinstance(ends, list):
        raise TranscriptionProviderError("sarvam", "timestamps_invalid", "Sarvam timestamp starts/ends must be lists")
    if len(words) != len(starts) or len(words) != len(ends):
        raise TranscriptionProviderError("sarvam", "timestamps_invalid", "Sarvam timestamp array lengths differ")
    normalized: list[dict[str, Any]] = []
    last_start = -0.001
    last_end = -0.001

    for i, word in enumerate(words):
        try:
            start = float(starts[i])
            end = float(ends[i])
        except (IndexError, TypeError, ValueError):
            raise TranscriptionProviderError("sarvam", "timestamps_invalid", "Sarvam timestamp value is not numeric")
        if not (start == start and end == end) or start in {float("inf"), float("-inf")} or end in {float("inf"), float("-inf")}:
            raise TranscriptionProviderError("sarvam", "timestamps_invalid", "Sarvam timestamp value is not finite")
        if end <= start:
            raise TranscriptionProviderError("sarvam", "timestamps_invalid", "Sarvam timestamp end is not greater than start")
        if start + 0.001 < last_start or end + 0.001 < last_end:
            raise TranscriptionProviderError("sarvam", "timestamps_invalid", "Sarvam word timestamps are not monotonic")
        token = str(word).strip()
        if not token:
            raise TranscriptionProviderError("sarvam", "timestamps_invalid", "Sarvam timestamp word is empty")
        normalized.append(
            {
                "word": token,
                "displayWord": token,
                "start": start,
                "end": end,
                "score": float(payload.get("language_probability") or 0.0),
                "provider": "sarvam",
                "model": "saaras:v3",
                "timingGranularity": timing_granularity,
                "timing_source": "provider_segment_derived" if timing_granularity == "phrase" else "provider_native_word",
                "timingSource": "provider_segment_derived" if timing_granularity == "phrase" else "provider_native_word",
                "timestampBasis": "chunk_local",
                "preservePhraseTiming": preserve_phrase_timing,
            }
        )
        last_start = start
        last_end = end

    return normalized


def resolve_sarvam_request_options(source_language: str | None, output_language: str | None = "original") -> dict[str, str]:
    source = normalize_language_mode(source_language)
    output = normalize_caption_output(output_language)
    language_code = SARVAM_LANGUAGE_CODES.get(source)
    if not language_code:
        raise TranscriptionProviderError("sarvam", "invalid_request", "Unsupported Sarvam language mode.")

    if output == "english" and source != "english":
        mode = "translate"
    elif source in {"hinglish", "telgish"}:
        mode = "translit"
    elif source in {"auto", "auto_mixed_indian"}:
        mode = "codemix"
    else:
        mode = "transcribe"

    return {"mode": mode, "language_code": language_code}


def _sarvam_mode_for_language(
    language_mode: str,
    provider_options: dict[str, Any] | None = None,
    output_language: str | None = "original",
) -> tuple[str, str]:
    # Provider options come from the global admin model configuration. They must
    # not force every production job into the language used by the admin test.
    resolved = resolve_sarvam_request_options(language_mode, output_language)
    return resolved["mode"], resolved["language_code"]


def _sarvam_error_category(status_code: int, provider_code: str | None) -> str:
    code = str(provider_code or "").lower()
    if status_code in {401, 403} or code in {"invalid_api_key", "unauthorized", "forbidden"}:
        return "authentication_failed" if status_code == 401 else "permission_denied"
    if status_code == 404:
        return "model_not_found"
    if status_code in {400, 422}:
        return "invalid_request"
    if status_code == 429:
        return "rate_limited"
    if status_code in {500, 503, 504}:
        return "provider_unavailable"
    return "unknown_provider_error"


def _call_sarvam(audio_path: str, language_mode: str, transcription_config_snapshot: Any = None) -> dict:
    api_key = os.environ.get("SARVAM_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("STT_PROVIDER=sarvam requires SARVAM_API_KEY.")

    snapshot = coerce_snapshot(transcription_config_snapshot)
    model = snapshot.model if snapshot else "saaras:v3"
    output_language = snapshot.output_language if snapshot and snapshot.output_language else "original"
    mode, language_code = _sarvam_mode_for_language(language_mode, output_language=output_language)
    timeout_seconds = (snapshot.resolved_pipeline_options or {}).get("performance", {}).get("providerTimeoutSeconds") if snapshot else None

    upload_mime_type = _sniff_audio_mime_type(audio_path) or "application/octet-stream"
    with open(audio_path, "rb") as file:
        response = requests.post(
            SARVAM_URL,
            headers={"api-subscription-key": api_key},
            data={
                "model": model,
                "mode": mode,
                "language_code": language_code,
                "with_timestamps": "true",
            },
            files={"file": (os.path.basename(audio_path), file, upload_mime_type)},
            timeout=int(timeout_seconds or STT_PROVIDER_ATTEMPT_TIMEOUT_SECONDS),
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

        category = _sarvam_error_category(response.status_code, provider_code)
        raise TranscriptionProviderError(
            "sarvam",
            category,
            _sanitize_provider_message(provider_message) or category,
            response.status_code,
            provider_code=provider_code,
            request_id=response.headers.get("x-request-id") if hasattr(response, "headers") else None,
        )

    payload = response.json()
    provider_raw_text = (payload.get("transcript") or "").strip()
    detected_language_code = payload.get("language_code")
    return {
        "text": provider_raw_text,
        "language": detected_language_code,
        "duration": None,
        "segments": [],
        "words": _normalize_sarvam_words(payload),
        "provider": "sarvam",
        "model": model,
        "provider_mode": mode,
        "provider_language_code": language_code,
        "provider_request_id": payload.get("request_id"),
        "request_id": payload.get("request_id"),
        "timestamp_strategy": "provider_word",
        "timestamp_capability": "native_provider_word",
        "timestamp_basis": "chunk_local",
        "language_probability": payload.get("language_probability"),
        "providerRawText": provider_raw_text,
        "providerMode": mode,
        "providerLanguageCode": language_code,
        "detectedLanguageCode": detected_language_code,
        "normalizedText": provider_raw_text,
        "displayText": provider_raw_text,
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


def transcribe_audio(
    audio_path: str,
    language_mode: str = "english",
    *,
    progress_callback=None,
    chunk_index: int | None = None,
    total_chunks: int | None = None,
    transcription_config_snapshot: Any = None,
) -> dict:
    """Provider abstraction for speech-to-text used by the pipeline."""
    normalized_mode = normalize_language_mode(language_mode)
    snapshot = coerce_snapshot(transcription_config_snapshot)
    if snapshot:
        entry = catalog_entry(snapshot.provider, snapshot.model)
        if entry is None or entry.timestamp_strategy != snapshot.timestamp_strategy:
            raise TranscriptionProviderError(snapshot.provider, "unsupported_model", "Unsupported transcription model.")
        providers = [snapshot.provider]
    else:
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
            "transcription_provider_attempt provider=%s attempt=%s chunk=%s total_chunks=%s",
            provider,
            attempt,
            chunk_index if chunk_index is not None else "-",
            total_chunks if total_chunks is not None else "-",
        )
        attempt_started = time.monotonic()
        if progress_callback:
            progress_callback("attempt", provider, None)
        try:
            result = (
                _call_provider(provider, audio_path, normalized_mode, transcription_config_snapshot=snapshot)
                if snapshot
                else _call_provider(provider, audio_path, normalized_mode)
            )
            elapsed_ms = int((time.monotonic() - attempt_started) * 1000)
            normalized = _normalize_provider_result(result, provider)
            validated = _validate_transcription_result(
                normalized,
                provider,
                audio_path,
                timestamp_strategy=snapshot.timestamp_strategy if snapshot else normalized.get("timestamp_strategy"),
            )
            if attempted:
                validated["fallback"] = True
                validated["fallback_from"] = attempted.copy()
            logger.info(
                "transcription_provider_succeeded provider=%s fallback_from=%s chunk=%s total_chunks=%s duration_ms=%s",
                provider,
                ",".join(attempted),
                chunk_index if chunk_index is not None else "-",
                total_chunks if total_chunks is not None else "-",
                elapsed_ms,
            )
            if progress_callback:
                progress_callback("succeeded", provider, None)
            return validated
        except Exception as exc:
            elapsed_ms = int((time.monotonic() - attempt_started) * 1000)
            category, status = _failure_category(exc)
            failures.append((provider, category, status))
            attempted.append(provider)
            provider_code = getattr(exc, "provider_code", None)
            logger.warning(
                "transcription_provider_failed provider=%s category=%s%s%s chunk=%s total_chunks=%s duration_ms=%s",
                provider,
                category,
                f" status={status}" if status else "",
                f" provider_code={provider_code}" if provider_code else "",
                chunk_index if chunk_index is not None else "-",
                total_chunks if total_chunks is not None else "-",
                elapsed_ms,
            )
            if progress_callback:
                progress_callback("failed", provider, category)

    summary = ", ".join(
        _failure_summary(provider, category, status) for provider, category, status in failures
    )
    if snapshot and snapshot.strict_provider:
        raise RuntimeError("Caption generation is temporarily unavailable. Your upload is safe. Please retry shortly.")
    raise RuntimeError(f"All configured transcription providers failed: {summary}.")


def _call_provider(provider: str, audio_path: str, normalized_mode: str, *, transcription_config_snapshot: Any = None) -> dict:
    if provider == "gemini":
        return _call_gemini(audio_path, normalized_mode, transcription_config_snapshot)
    if provider == "sarvam":
        return _call_sarvam(audio_path, normalized_mode, transcription_config_snapshot)
    if provider in {"openai_whisper", "openai"}:
        return _call_openai_whisper(audio_path, normalized_mode, transcription_config_snapshot)
    if provider == "groq_whisper":
        return transcribe_chunk_with_retry(audio_path, language=normalized_mode)
    raise TranscriptionProviderError(provider, "unsupported_provider", "Unsupported transcription provider.")


async def transcribe_sarvam_chunks_bounded(
    audio_paths: list[str],
    language_mode: str,
    progress_callback=None,
    transcription_config_snapshot: Any = None,
) -> list[dict]:
    """Run blocking Sarvam REST calls concurrently with a strict upper bound."""
    normalized_mode = normalize_language_mode(language_mode)
    snapshot = coerce_snapshot(transcription_config_snapshot)
    if (snapshot.provider if snapshot else _resolve_provider(normalized_mode)) != "sarvam":
        return [
            transcribe_audio(audio_path, language_mode=normalized_mode, transcription_config_snapshot=transcription_config_snapshot)
            for audio_path in audio_paths
        ]
    try:
        configured = (snapshot.resolved_pipeline_options or {}).get("performance", {}).get("sarvamMaxConcurrency") if snapshot else None
        concurrency = int(configured or os.getenv("SARVAM_MAX_CONCURRENCY", "2"))
    except ValueError:
        concurrency = 2
    concurrency = max(1, min(concurrency, 8))
    semaphore = asyncio.Semaphore(concurrency)
    completed = 0
    completed_lock = asyncio.Lock()

    async def transcribe_one(index: int, audio_path: str) -> tuple[int, dict]:
        nonlocal completed
        async with semaphore:
            if snapshot:
                result = await asyncio.to_thread(
                    transcribe_audio,
                    audio_path,
                    normalized_mode,
                    transcription_config_snapshot=transcription_config_snapshot,
                )
            else:
                result = await asyncio.to_thread(transcribe_audio, audio_path, normalized_mode)
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
