from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

TranscriptionProvider = Literal["gemini", "openai", "sarvam"]
TimestampStrategy = Literal["provider_word", "structured_word_validate", "local_forced_alignment"]


@dataclass(frozen=True)
class CatalogEntry:
    provider: TranscriptionProvider
    model: str
    display_name: str
    enabled: bool
    timestamp_capability: str
    timestamp_strategy: TimestampStrategy
    required_secret: str
    supported_response_formats: tuple[str, ...]
    max_input_bytes: int
    max_chunk_duration_seconds: int
    supported_language_modes: tuple[str, ...]
    supported_provider_modes: tuple[str, ...]
    local_alignment_required: bool
    retryable_http_statuses: tuple[int, ...]


LANGUAGE_MODES = ("english", "hindi", "hinglish", "telugu", "telgish", "auto_mixed_indian")

TRANSCRIPTION_PROVIDER_CATALOG: tuple[CatalogEntry, ...] = (
    CatalogEntry(
        "gemini",
        "gemini-3.5-flash",
        "Gemini 3.5 Flash",
        True,
        "Transcript text with Capinsta local word alignment",
        "local_forced_alignment",
        "GEMINI_API_KEY",
        ("application/json",),
        2_000_000_000,
        600,
        LANGUAGE_MODES,
        ("transcribe",),
        True,
        (429, 500, 503, 504),
    ),
    CatalogEntry(
        "gemini",
        "gemini-2.5-flash",
        "Gemini 2.5 Flash",
        True,
        "Transcript text with Capinsta local word alignment",
        "local_forced_alignment",
        "GEMINI_API_KEY",
        ("application/json",),
        2_000_000_000,
        600,
        LANGUAGE_MODES,
        ("transcribe",),
        True,
        (429, 500, 503, 504),
    ),
    CatalogEntry(
        "openai",
        "whisper-1",
        "OpenAI Whisper",
        True,
        "Native provider word timestamps",
        "provider_word",
        "OPENAI_API_KEY",
        ("verbose_json",),
        25_000_000,
        600,
        LANGUAGE_MODES,
        ("transcribe",),
        False,
        (429, 500, 503, 504),
    ),
    CatalogEntry(
        "openai",
        "gpt-4o-mini-transcribe",
        "OpenAI GPT-4o Mini Transcribe",
        True,
        "Transcript text with Capinsta local word alignment",
        "local_forced_alignment",
        "OPENAI_API_KEY",
        ("json",),
        25_000_000,
        600,
        LANGUAGE_MODES,
        ("transcribe",),
        True,
        (429, 500, 503, 504),
    ),
    CatalogEntry(
        "openai",
        "gpt-4o-transcribe",
        "OpenAI GPT-4o Transcribe",
        True,
        "Transcript text with Capinsta local word alignment",
        "local_forced_alignment",
        "OPENAI_API_KEY",
        ("json",),
        25_000_000,
        600,
        LANGUAGE_MODES,
        ("transcribe",),
        True,
        (429, 500, 503, 504),
    ),
    CatalogEntry(
        "sarvam",
        "saaras:v3",
        "Sarvam Saaras v3",
        True,
        "REST /speech-to-text with with_timestamps=true returns native word timestamps; Sarvam Batch is chunk timestamps only",
        "provider_word",
        "SARVAM_API_KEY",
        ("json",),
        25_000_000,
        25,
        LANGUAGE_MODES,
        ("transcribe", "verbatim", "translit", "codemix"),
        False,
        (429, 500, 503),
    ),
)


def catalog_entry(provider: str, model: str) -> CatalogEntry | None:
    provider = provider.strip().lower()
    model = model.strip()
    for entry in TRANSCRIPTION_PROVIDER_CATALOG:
        if entry.enabled and entry.provider == provider and entry.model == model:
            return entry
    return None


def validate_catalog_selection(provider: str, model: str, timestamp_strategy: str, provider_options: dict | None = None) -> CatalogEntry:
    entry = catalog_entry(provider, model)
    if entry is None:
        raise ValueError("unsupported_model")
    if timestamp_strategy != entry.timestamp_strategy:
        raise ValueError("incompatible_timestamp_strategy")
    options = provider_options or {}
    mode = str(options.get("mode") or "transcribe")
    if entry.provider == "sarvam" and mode not in entry.supported_provider_modes:
        raise ValueError("invalid_provider_options")
    if entry.provider != "sarvam" and options:
        raise ValueError("invalid_provider_options")
    return entry


def forced_alignment_ready() -> tuple[bool, list[str]]:
    from ai_pipeline.timing import alignment_provider_status

    status = alignment_provider_status()
    return (
        bool(status.get("realForcedAlignmentAvailable")),
        [str(reason) for reason in (status.get("forcedAlignmentUnavailableReasons") or [])],
    )


def model_runtime_availability(entry: CatalogEntry) -> dict:
    if not entry.enabled:
        return {
            "productionReady": False,
            "reason": "model_disabled",
            "message": "This provider/model is disabled.",
        }
    if not entry.local_alignment_required:
        return {
            "productionReady": True,
            "reason": None,
            "message": None,
        }
    ready, reasons = forced_alignment_ready()
    return {
        "productionReady": ready,
        "reason": None if ready else "forced_alignment_unavailable",
        "message": None if ready else "Requires forced alignment - backend aligner unavailable.",
        "unavailableReasons": reasons,
    }


def public_catalog() -> list[dict]:
    return [
        {
            "provider": entry.provider,
            "model": entry.model,
            "displayName": entry.display_name,
            "enabled": entry.enabled,
            "timestampCapability": entry.timestamp_capability,
            "timestampStrategy": entry.timestamp_strategy,
            "requiredSecret": entry.required_secret,
            "supportedResponseFormats": list(entry.supported_response_formats),
            "maxInputBytes": entry.max_input_bytes,
            "maxChunkDurationSeconds": entry.max_chunk_duration_seconds,
            "supportedLanguageModes": list(entry.supported_language_modes),
            "supportedProviderModes": list(entry.supported_provider_modes),
            "localAlignmentRequired": entry.local_alignment_required,
            "retryableHttpStatuses": list(entry.retryable_http_statuses),
            **model_runtime_availability(entry),
        }
        for entry in TRANSCRIPTION_PROVIDER_CATALOG
    ]
