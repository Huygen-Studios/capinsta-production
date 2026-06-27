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
    native_word_timing_support: bool = False
    native_segment_timing_support: bool = False
    vad_chunking_support: bool = True
    stable_ts_compatibility: bool = True
    supported_stable_ts_models: tuple[str, ...] = ("tiny", "base", "small", "medium")
    estimated_timing_compatibility: bool = False
    activation_preflight: str = "credential_check_plus_real_audio_test"
    availability_status: Literal["production_ready", "experimental", "disabled", "unavailable"] = "experimental"


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
        True,
        True,
        True,
        False,
        (),
        False,
        "credential_check_plus_verbose_json_word_timestamp_test",
        "experimental",
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
        True,
        True,
        True,
        True,
        ("tiny", "base", "small", "medium"),
        False,
        "credential_check_plus_rest_speech_to_text_with_timestamps",
        "experimental",
    ),
)


def _alias_key(value: str) -> str:
    return " ".join(value.strip().lower().replace("-", " ").replace("_", " ").split())


_PROVIDER_ALIASES: dict[str, TranscriptionProvider] = {
    "google gemini": "gemini",
    "gemini": "gemini",
    "openai": "openai",
    "openai whisper": "openai",
    "sarvam": "sarvam",
    "sarvam saaras": "sarvam",
    "sarvam saaras v3": "sarvam",
}


def canonical_catalog_selection(provider: str, model: str) -> tuple[str, str, list[str]]:
    """Resolve legacy/display values to canonical provider/model keys.

    This is intentionally separate from ``catalog_entry`` so display labels are
    never accepted as stored internal keys by accident.
    """
    raw_provider = provider.strip()
    raw_model = model.strip()
    aliases: list[str] = []

    exact = catalog_entry(raw_provider, raw_model)
    if exact is not None:
        return exact.provider, exact.model, aliases

    provider_key = _PROVIDER_ALIASES.get(_alias_key(raw_provider), raw_provider.lower())
    if provider_key != raw_provider:
        aliases.append("provider_alias")

    for entry in TRANSCRIPTION_PROVIDER_CATALOG:
        if _alias_key(raw_provider) == _alias_key(entry.display_name):
            provider_key = entry.provider
            if not raw_model or _alias_key(raw_model) == _alias_key(entry.display_name):
                aliases.extend(["provider_display_label", "model_display_label"])
                return entry.provider, entry.model, aliases
            aliases.append("provider_display_label")
            break

    model_key = raw_model
    for entry in TRANSCRIPTION_PROVIDER_CATALOG:
        if entry.provider != provider_key:
            continue
        candidates = {
            _alias_key(entry.model),
            _alias_key(entry.display_name),
            _alias_key(entry.display_name.replace(entry.provider, "")),
        }
        if _alias_key(raw_model) in candidates:
            model_key = entry.model
            if raw_model != entry.model:
                aliases.append("model_alias")
            break

    return str(provider_key), model_key, aliases


def catalog_entry(provider: str, model: str) -> CatalogEntry | None:
    provider = provider.strip().lower()
    model = model.strip()
    for entry in TRANSCRIPTION_PROVIDER_CATALOG:
        if entry.enabled and entry.provider == provider and entry.model == model:
            return entry
    return None


def validate_catalog_selection(provider: str, model: str, timestamp_strategy: str, provider_options: dict | None = None) -> CatalogEntry:
    canonical_provider, canonical_model, _aliases = canonical_catalog_selection(provider, model)
    entry = catalog_entry(canonical_provider, canonical_model)
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
            "nativeWordTimingSupport": entry.native_word_timing_support,
            "nativeSegmentTimingSupport": entry.native_segment_timing_support,
            "vadChunkingSupport": entry.vad_chunking_support,
            "stableTsCompatibility": entry.stable_ts_compatibility,
            "supportedStableTsModels": list(entry.supported_stable_ts_models),
            "estimatedTimingCompatibility": entry.estimated_timing_compatibility,
            "activationPreflight": entry.activation_preflight,
            "availabilityStatus": entry.availability_status,
            **model_runtime_availability(entry),
        }
        for entry in TRANSCRIPTION_PROVIDER_CATALOG
    ]
