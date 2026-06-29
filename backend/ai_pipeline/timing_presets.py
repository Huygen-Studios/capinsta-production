from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Literal

from .pipeline_config import resolve_pipeline_config

PresetStatus = Literal["production_ready", "experimental", "disabled", "unavailable"]
CompatibilityState = Literal["compatible", "compatible_reduced", "unsupported"]


CONFIG_FIELD_RANGES: dict[str, dict[str, Any]] = {
    "timingSourcePolicy": {
        "type": "enum",
        "values": ["native_required", "native_then_forced", "forced", "estimated_debug_only"],
    },
    "audioChunking.vadEnabled": {"type": "boolean"},
    "audioChunking.targetSeconds": {"type": "number", "min": 3.0, "max": 120.0, "step": 0.5},
    "audioChunking.maxSeconds": {"type": "number", "min": 3.0, "max": 180.0, "step": 0.5},
    "audioChunking.paddingSeconds": {"type": "number", "min": 0.0, "max": 2.0, "step": 0.01},
    "vad.pauseThresholdSeconds": {"type": "number", "min": 0.05, "max": 3.0, "step": 0.01},
    "vad.silenceThresholdDb": {"type": "nullable_number", "min": -90.0, "max": 0.0, "step": 1.0},
    "vad.sileroEnabled": {"type": "boolean"},
    "vad.sileroSpeechThreshold": {"type": "number", "min": 0.01, "max": 0.99, "step": 0.01},
    "vad.sileroMinSpeechDurationMs": {"type": "integer", "min": 0, "max": 2000, "step": 10},
    "vad.sileroMinSilenceDurationMs": {"type": "integer", "min": 0, "max": 3000, "step": 10},
    "vad.sileroSpeechPadMs": {"type": "integer", "min": 0, "max": 1000, "step": 5},
    "alignment.stableTsEnabled": {"type": "boolean"},
    "alignment.stableTsModel": {"type": "enum", "values": ["tiny", "base", "small", "medium"]},
    "alignment.stableTsDevice": {"type": "enum", "values": ["auto", "cpu", "cuda"]},
    "alignment.stableTsMinMatchCoverage": {"type": "number", "min": 0.0, "max": 1.0, "step": 0.01},
    "alignment.stableTsMinWordRatio": {"type": "number", "min": 0.0, "max": 10.0, "step": 0.01},
    "alignment.stableTsMaxWordRatio": {"type": "number", "min": 0.1, "max": 10.0, "step": 0.01},
    "alignment.allowStableTsOrderFallback": {"type": "boolean"},
    "autoSync.enabled": {"type": "boolean"},
    "autoSync.maxShiftSeconds": {"type": "number", "min": 0.0, "max": 10.0, "step": 0.05},
    "autoSync.minScore": {"type": "number", "min": 0.0, "max": 1.0, "step": 0.01},
    "autoSync.allowSkew": {"type": "boolean"},
    "autoSync.maxSkewDelta": {"type": "number", "min": 0.0, "max": 1.0, "step": 0.001},
    "captionChunking.maxWords": {"type": "integer", "min": 1, "max": 24, "step": 1},
    "captionChunking.maxCharacters": {"type": "integer", "min": 8, "max": 120, "step": 1},
    "captionChunking.maxDurationSeconds": {"type": "number", "min": 0.1, "max": 30.0, "step": 0.1},
    "captionChunking.phraseHoldSeconds": {"type": "number", "min": 0.0, "max": 3.0, "step": 0.01},
    "performance.providerTimeoutSeconds": {"type": "integer", "min": 5, "max": 600, "step": 1},
    "performance.sarvamMaxConcurrency": {"type": "integer", "min": 1, "max": 8, "step": 1},
    "performance.stableTsMaxAudioSeconds": {"type": "number", "min": 1.0, "max": 3600.0, "step": 1.0},
    "quality.allowEstimatedWords": {"type": "boolean"},
    "quality.maximumEstimatedWordRatio": {"type": "number", "min": 0.0, "max": 1.0, "step": 0.01},
}


ENV_KEY_TO_PATH: dict[str, tuple[str, ...]] = {
    "TIMING_SOURCE_POLICY": ("timingSourcePolicy",),
    "VAD_TARGET_SECONDS": ("audioChunking", "targetSeconds"),
    "VAD_MAX_SECONDS": ("audioChunking", "maxSeconds"),
    "CHUNK_PADDING_SECONDS": ("audioChunking", "paddingSeconds"),
    "USE_VAD_CHUNKING": ("audioChunking", "vadEnabled"),
    "PAUSE_SPLIT_SECONDS": ("vad", "pauseThresholdSeconds"),
    "ENABLE_SILERO_VAD": ("vad", "sileroEnabled"),
    "SILERO_THRESHOLD": ("vad", "sileroSpeechThreshold"),
    "SILERO_MIN_SPEECH_DURATION_MS": ("vad", "sileroMinSpeechDurationMs"),
    "SILERO_MIN_SILENCE_DURATION_MS": ("vad", "sileroMinSilenceDurationMs"),
    "SILERO_SPEECH_PAD_MS": ("vad", "sileroSpeechPadMs"),
    "ENABLE_STABLE_TS": ("alignment", "stableTsEnabled"),
    "STABLE_TS_MODEL": ("alignment", "stableTsModel"),
    "MIN_MATCH_COVERAGE": ("alignment", "stableTsMinMatchCoverage"),
    "ALLOW_STABLE_TS_ORDER_FALLBACK": ("alignment", "allowStableTsOrderFallback"),
    "ENABLE_AUTO_GLOBAL_SYNC": ("autoSync", "enabled"),
    "MAX_SHIFT_SECONDS": ("autoSync", "maxShiftSeconds"),
    "MIN_SYNC_SCORE": ("autoSync", "minScore"),
    "ALLOW_SPEED_SKEW_CORRECTION": ("autoSync", "allowSkew"),
    "MAX_SKEW_DELTA": ("autoSync", "maxSkewDelta"),
    "CAPTION_MAX_WORDS": ("captionChunking", "maxWords"),
    "CAPTION_MAX_CHARS": ("captionChunking", "maxCharacters"),
    "MAX_DURATION_SECONDS": ("captionChunking", "maxDurationSeconds"),
    "PHRASE_HOLD_SECONDS": ("captionChunking", "phraseHoldSeconds"),
    "PROVIDER_TIMEOUT_SECONDS": ("performance", "providerTimeoutSeconds"),
    "SARVAM_CONCURRENCY": ("performance", "sarvamMaxConcurrency"),
    "STABLE_TS_MAX_AUDIO_SECONDS": ("performance", "stableTsMaxAudioSeconds"),
    "ALLOW_ESTIMATED_WORDS": ("quality", "allowEstimatedWords"),
    "MAXIMUM_ESTIMATED_WORD_RATIO": ("quality", "maximumEstimatedWordRatio"),
}


def _options_from_env_like(values: dict[str, Any]) -> dict[str, Any]:
    options: dict[str, Any] = {}
    for key, value in values.items():
        path = ENV_KEY_TO_PATH[key]
        target = options
        for part in path[:-1]:
            target = target.setdefault(part, {})
        target[path[-1]] = value
        if key == "PAUSE_SPLIT_SECONDS":
            options.setdefault("captionChunking", {})["pauseSplitThresholdSeconds"] = value
    return options


@dataclass(frozen=True)
class TimingPreset:
    id: str
    display_name: str
    family: str
    purpose: str
    status: PresetStatus
    version: int
    provider_keys: tuple[str, ...]
    model_keys: tuple[str, ...]
    performance_cost: str
    quality_threshold: str
    locked_fields: tuple[str, ...]
    adjustable_fields: tuple[str, ...]
    values: dict[str, Any]

    @property
    def pipeline_options(self) -> dict[str, Any]:
        return resolve_pipeline_config(_options_from_env_like(self.values)).to_dict()

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "displayName": self.display_name,
            "family": self.family,
            "purpose": self.purpose,
            "status": self.status,
            "version": self.version,
            "supportedProviders": list(self.provider_keys),
            "supportedModels": list(self.model_keys),
            "performanceCost": self.performance_cost,
            "qualityThreshold": self.quality_threshold,
            "lockedFields": list(self.locked_fields),
            "adjustableFields": list(self.adjustable_fields),
            "allowedValues": {field: CONFIG_FIELD_RANGES[field] for field in self.adjustable_fields if field in CONFIG_FIELD_RANGES},
            "pipelineOptions": self.pipeline_options,
            "expectedTimingSourcePolicy": self.pipeline_options["timingSourcePolicy"],
        }


_COMMON_ADJUSTABLE_FIELDS = (
    "audioChunking.targetSeconds",
    "audioChunking.maxSeconds",
    "audioChunking.paddingSeconds",
    "vad.pauseThresholdSeconds",
    "vad.sileroSpeechThreshold",
    "vad.sileroMinSpeechDurationMs",
    "vad.sileroMinSilenceDurationMs",
    "vad.sileroSpeechPadMs",
    "alignment.stableTsModel",
    "alignment.stableTsMinMatchCoverage",
    "captionChunking.maxWords",
    "captionChunking.maxCharacters",
    "captionChunking.maxDurationSeconds",
    "captionChunking.phraseHoldSeconds",
    "quality.maximumEstimatedWordRatio",
)


def _preset(
    preset_id: str,
    display_name: str,
    family: str,
    purpose: str,
    values: dict[str, Any],
    *,
    status: PresetStatus = "experimental",
    performance_cost: str = "medium",
    quality_threshold: str = "strict",
    provider_keys: tuple[str, ...] = ("sarvam",),
    model_keys: tuple[str, ...] = ("saaras:v3",),
) -> TimingPreset:
    return TimingPreset(
        id=preset_id,
        display_name=display_name,
        family=family,
        purpose=purpose,
        status=status,
        version=1,
        provider_keys=provider_keys,
        model_keys=model_keys,
        performance_cost=performance_cost,
        quality_threshold=quality_threshold,
        locked_fields=(
            "alignment.allowStableTsOrderFallback",
            "autoSync.enabled",
            "autoSync.allowSkew",
            "quality.allowEstimatedWords",
            "timingSourcePolicy",
        ),
        adjustable_fields=_COMMON_ADJUSTABLE_FIELDS,
        values=values,
    )


TIMING_PRESETS: tuple[TimingPreset, ...] = (
    _preset(
        "sarvam_telgish_safe_native",
        "Sarvam Telgish Safe Native",
        "Telugu/Telgish",
        "Telugu/Telgish safety-first; prevent sentence crossover.",
        {
            "TIMING_SOURCE_POLICY": "native_then_forced",
            "VAD_TARGET_SECONDS": 8,
            "VAD_MAX_SECONDS": 12,
            "CHUNK_PADDING_SECONDS": 0.18,
            "USE_VAD_CHUNKING": True,
            "PAUSE_SPLIT_SECONDS": 0.25,
            "ENABLE_SILERO_VAD": True,
            "SILERO_THRESHOLD": 0.50,
            "SILERO_MIN_SPEECH_DURATION_MS": 80,
            "SILERO_MIN_SILENCE_DURATION_MS": 180,
            "SILERO_SPEECH_PAD_MS": 30,
            "ENABLE_STABLE_TS": False,
            "ALLOW_STABLE_TS_ORDER_FALLBACK": False,
            "ENABLE_AUTO_GLOBAL_SYNC": False,
            "ALLOW_SPEED_SKEW_CORRECTION": False,
            "CAPTION_MAX_WORDS": 3,
            "CAPTION_MAX_CHARS": 28,
            "MAX_DURATION_SECONDS": 2,
            "PHRASE_HOLD_SECONDS": 0.05,
            "ALLOW_ESTIMATED_WORDS": False,
            "MAXIMUM_ESTIMATED_WORD_RATIO": 0.0,
        },
        status="experimental",
        performance_cost="low",
        quality_threshold="strict_native_or_fail",
    ),
    _preset(
        "sarvam_telgish_balanced",
        "Sarvam Telgish Balanced",
        "Telugu/Telgish",
        "Telugu/Telgish with bounded stable-ts refinement.",
        {
            "TIMING_SOURCE_POLICY": "native_then_forced",
            "VAD_TARGET_SECONDS": 8,
            "VAD_MAX_SECONDS": 12,
            "CHUNK_PADDING_SECONDS": 0.18,
            "PAUSE_SPLIT_SECONDS": 0.25,
            "ENABLE_SILERO_VAD": True,
            "SILERO_THRESHOLD": 0.50,
            "SILERO_MIN_SPEECH_DURATION_MS": 80,
            "SILERO_MIN_SILENCE_DURATION_MS": 180,
            "SILERO_SPEECH_PAD_MS": 30,
            "ENABLE_STABLE_TS": True,
            "STABLE_TS_MODEL": "small",
            "MIN_MATCH_COVERAGE": 0.65,
            "ALLOW_STABLE_TS_ORDER_FALLBACK": False,
            "ENABLE_AUTO_GLOBAL_SYNC": False,
            "ALLOW_SPEED_SKEW_CORRECTION": False,
            "CAPTION_MAX_WORDS": 3,
            "CAPTION_MAX_CHARS": 28,
            "MAX_DURATION_SECONDS": 2,
            "PHRASE_HOLD_SECONDS": 0.05,
            "ALLOW_ESTIMATED_WORDS": True,
            "MAXIMUM_ESTIMATED_WORD_RATIO": 0.10,
        },
        status="experimental",
        performance_cost="medium",
    ),
    _preset(
        "sarvam_fast_dialogue",
        "Sarvam Fast Dialogue",
        "Fast dialogue",
        "Rapid speech, short reactions, tight phrase boundaries.",
        {
            "TIMING_SOURCE_POLICY": "native_then_forced",
            "VAD_TARGET_SECONDS": 4,
            "VAD_MAX_SECONDS": 6,
            "CHUNK_PADDING_SECONDS": 0.12,
            "PAUSE_SPLIT_SECONDS": 0.18,
            "ENABLE_SILERO_VAD": True,
            "SILERO_THRESHOLD": 0.48,
            "SILERO_MIN_SPEECH_DURATION_MS": 60,
            "SILERO_MIN_SILENCE_DURATION_MS": 120,
            "SILERO_SPEECH_PAD_MS": 20,
            "ENABLE_STABLE_TS": True,
            "STABLE_TS_MODEL": "small",
            "MIN_MATCH_COVERAGE": 0.70,
            "ALLOW_STABLE_TS_ORDER_FALLBACK": False,
            "ENABLE_AUTO_GLOBAL_SYNC": False,
            "ALLOW_SPEED_SKEW_CORRECTION": False,
            "CAPTION_MAX_WORDS": 2,
            "CAPTION_MAX_CHARS": 20,
            "MAX_DURATION_SECONDS": 1.4,
            "PHRASE_HOLD_SECONDS": 0.03,
            "ALLOW_ESTIMATED_WORDS": True,
            "MAXIMUM_ESTIMATED_WORD_RATIO": 0.08,
        },
        status="experimental",
        performance_cost="medium",
    ),
    _preset(
        "sarvam_music_pause_protection",
        "Sarvam Music Pause Protection",
        "Music/noise",
        "Dialogue over music, reels, background score.",
        {
            "TIMING_SOURCE_POLICY": "native_then_forced",
            "VAD_TARGET_SECONDS": 6,
            "VAD_MAX_SECONDS": 8,
            "CHUNK_PADDING_SECONDS": 0.16,
            "PAUSE_SPLIT_SECONDS": 0.32,
            "ENABLE_SILERO_VAD": True,
            "SILERO_THRESHOLD": 0.58,
            "SILERO_MIN_SPEECH_DURATION_MS": 100,
            "SILERO_MIN_SILENCE_DURATION_MS": 220,
            "SILERO_SPEECH_PAD_MS": 25,
            "ENABLE_STABLE_TS": True,
            "STABLE_TS_MODEL": "small",
            "MIN_MATCH_COVERAGE": 0.70,
            "ALLOW_STABLE_TS_ORDER_FALLBACK": False,
            "ENABLE_AUTO_GLOBAL_SYNC": False,
            "ALLOW_SPEED_SKEW_CORRECTION": False,
            "CAPTION_MAX_WORDS": 3,
            "CAPTION_MAX_CHARS": 26,
            "MAX_DURATION_SECONDS": 2,
            "PHRASE_HOLD_SECONDS": 0.06,
            "ALLOW_ESTIMATED_WORDS": True,
            "MAXIMUM_ESTIMATED_WORD_RATIO": 0.08,
        },
        status="experimental",
        performance_cost="medium",
    ),
    _preset(
        "sarvam_noisy_outdoor",
        "Sarvam Noisy Outdoor",
        "Music/noise",
        "Traffic, crowd noise, compression artifacts, outdoor speech.",
        {
            "TIMING_SOURCE_POLICY": "native_then_forced",
            "VAD_TARGET_SECONDS": 6,
            "VAD_MAX_SECONDS": 10,
            "CHUNK_PADDING_SECONDS": 0.20,
            "PAUSE_SPLIT_SECONDS": 0.35,
            "ENABLE_SILERO_VAD": True,
            "SILERO_THRESHOLD": 0.62,
            "SILERO_MIN_SPEECH_DURATION_MS": 140,
            "SILERO_MIN_SILENCE_DURATION_MS": 260,
            "SILERO_SPEECH_PAD_MS": 35,
            "ENABLE_STABLE_TS": True,
            "STABLE_TS_MODEL": "small",
            "MIN_MATCH_COVERAGE": 0.75,
            "ALLOW_STABLE_TS_ORDER_FALLBACK": False,
            "ENABLE_AUTO_GLOBAL_SYNC": False,
            "ALLOW_SPEED_SKEW_CORRECTION": False,
            "CAPTION_MAX_WORDS": 3,
            "CAPTION_MAX_CHARS": 28,
            "MAX_DURATION_SECONDS": 2.2,
            "PHRASE_HOLD_SECONDS": 0.08,
            "ALLOW_ESTIMATED_WORDS": True,
            "MAXIMUM_ESTIMATED_WORD_RATIO": 0.08,
        },
        status="experimental",
        performance_cost="medium",
    ),
    _preset(
        "sarvam_two_speaker_dialogue",
        "Sarvam Two-Speaker Dialogue",
        "Two-speaker",
        "Turn-heavy dialogue and short replies.",
        {
            "TIMING_SOURCE_POLICY": "native_then_forced",
            "VAD_TARGET_SECONDS": 4,
            "VAD_MAX_SECONDS": 6,
            "CHUNK_PADDING_SECONDS": 0.12,
            "PAUSE_SPLIT_SECONDS": 0.20,
            "ENABLE_SILERO_VAD": True,
            "SILERO_THRESHOLD": 0.52,
            "SILERO_MIN_SPEECH_DURATION_MS": 70,
            "SILERO_MIN_SILENCE_DURATION_MS": 140,
            "SILERO_SPEECH_PAD_MS": 20,
            "ENABLE_STABLE_TS": True,
            "STABLE_TS_MODEL": "small",
            "MIN_MATCH_COVERAGE": 0.70,
            "ALLOW_STABLE_TS_ORDER_FALLBACK": False,
            "ENABLE_AUTO_GLOBAL_SYNC": False,
            "ALLOW_SPEED_SKEW_CORRECTION": False,
            "CAPTION_MAX_WORDS": 2,
            "CAPTION_MAX_CHARS": 22,
            "MAX_DURATION_SECONDS": 1.6,
            "PHRASE_HOLD_SECONDS": 0.04,
            "ALLOW_ESTIMATED_WORDS": True,
            "MAXIMUM_ESTIMATED_WORD_RATIO": 0.08,
        },
        status="experimental",
        performance_cost="medium",
    ),
    _preset(
        "sarvam_code_switch",
        "Sarvam Code Switch",
        "Code-switch",
        "Telugu/Telgish plus English/Hindi/Hinglish.",
        {
            "TIMING_SOURCE_POLICY": "native_then_forced",
            "VAD_TARGET_SECONDS": 6,
            "VAD_MAX_SECONDS": 10,
            "CHUNK_PADDING_SECONDS": 0.18,
            "PAUSE_SPLIT_SECONDS": 0.28,
            "ENABLE_SILERO_VAD": True,
            "SILERO_THRESHOLD": 0.52,
            "SILERO_MIN_SPEECH_DURATION_MS": 80,
            "SILERO_MIN_SILENCE_DURATION_MS": 180,
            "SILERO_SPEECH_PAD_MS": 30,
            "ENABLE_STABLE_TS": True,
            "STABLE_TS_MODEL": "small",
            "MIN_MATCH_COVERAGE": 0.75,
            "ALLOW_STABLE_TS_ORDER_FALLBACK": False,
            "ENABLE_AUTO_GLOBAL_SYNC": False,
            "ALLOW_SPEED_SKEW_CORRECTION": False,
            "CAPTION_MAX_WORDS": 3,
            "CAPTION_MAX_CHARS": 30,
            "MAX_DURATION_SECONDS": 2,
            "PHRASE_HOLD_SECONDS": 0.05,
            "ALLOW_ESTIMATED_WORDS": True,
            "MAXIMUM_ESTIMATED_WORD_RATIO": 0.08,
        },
        status="experimental",
        performance_cost="medium",
    ),
    _preset(
        "sarvam_clean_monologue",
        "Sarvam Clean Monologue",
        "Clean monologue",
        "Clean single-speaker voiceover, podcast clips, tutorials.",
        {
            "TIMING_SOURCE_POLICY": "native_then_forced",
            "VAD_TARGET_SECONDS": 10,
            "VAD_MAX_SECONDS": 14,
            "CHUNK_PADDING_SECONDS": 0.22,
            "PAUSE_SPLIT_SECONDS": 0.40,
            "ENABLE_SILERO_VAD": True,
            "SILERO_THRESHOLD": 0.45,
            "SILERO_MIN_SPEECH_DURATION_MS": 100,
            "SILERO_MIN_SILENCE_DURATION_MS": 220,
            "SILERO_SPEECH_PAD_MS": 40,
            "ENABLE_STABLE_TS": True,
            "STABLE_TS_MODEL": "small",
            "MIN_MATCH_COVERAGE": 0.60,
            "ALLOW_STABLE_TS_ORDER_FALLBACK": False,
            "ENABLE_AUTO_GLOBAL_SYNC": False,
            "ALLOW_SPEED_SKEW_CORRECTION": False,
            "CAPTION_MAX_WORDS": 4,
            "CAPTION_MAX_CHARS": 36,
            "MAX_DURATION_SECONDS": 2.5,
            "PHRASE_HOLD_SECONDS": 0.08,
            "ALLOW_ESTIMATED_WORDS": True,
            "MAXIMUM_ESTIMATED_WORD_RATIO": 0.12,
        },
        status="experimental",
        performance_cost="medium",
    ),
    _preset(
        "provider_native_word_timing",
        "Provider Native Word Timing",
        "Native timing",
        "Any provider/model with trustworthy native word timestamps.",
        {
            "TIMING_SOURCE_POLICY": "native_then_forced",
            "VAD_TARGET_SECONDS": 8,
            "VAD_MAX_SECONDS": 12,
            "CHUNK_PADDING_SECONDS": 0.18,
            "PAUSE_SPLIT_SECONDS": 0.25,
            "ENABLE_SILERO_VAD": True,
            "SILERO_THRESHOLD": 0.50,
            "SILERO_MIN_SPEECH_DURATION_MS": 80,
            "SILERO_MIN_SILENCE_DURATION_MS": 180,
            "SILERO_SPEECH_PAD_MS": 30,
            "ENABLE_STABLE_TS": False,
            "ALLOW_STABLE_TS_ORDER_FALLBACK": False,
            "ENABLE_AUTO_GLOBAL_SYNC": False,
            "ALLOW_SPEED_SKEW_CORRECTION": False,
            "CAPTION_MAX_WORDS": 3,
            "CAPTION_MAX_CHARS": 28,
            "MAX_DURATION_SECONDS": 2,
            "PHRASE_HOLD_SECONDS": 0.05,
            "ALLOW_ESTIMATED_WORDS": False,
            "MAXIMUM_ESTIMATED_WORD_RATIO": 0.0,
        },
        status="experimental",
        performance_cost="low",
        provider_keys=("sarvam", "openai"),
        model_keys=("saaras:v3", "whisper-1"),
    ),
    _preset(
        "strict_timing_qa",
        "Strict Timing QA",
        "Strict QA",
        "Highest trust, no fabricated word timing, reject questionable jobs.",
        {
            "TIMING_SOURCE_POLICY": "native_then_forced",
            "VAD_TARGET_SECONDS": 6,
            "VAD_MAX_SECONDS": 8,
            "CHUNK_PADDING_SECONDS": 0.15,
            "PAUSE_SPLIT_SECONDS": 0.25,
            "ENABLE_SILERO_VAD": True,
            "SILERO_THRESHOLD": 0.55,
            "SILERO_MIN_SPEECH_DURATION_MS": 100,
            "SILERO_MIN_SILENCE_DURATION_MS": 200,
            "SILERO_SPEECH_PAD_MS": 25,
            "ENABLE_STABLE_TS": False,
            "ALLOW_STABLE_TS_ORDER_FALLBACK": False,
            "ENABLE_AUTO_GLOBAL_SYNC": False,
            "ALLOW_SPEED_SKEW_CORRECTION": False,
            "CAPTION_MAX_WORDS": 3,
            "CAPTION_MAX_CHARS": 28,
            "MAX_DURATION_SECONDS": 2,
            "PHRASE_HOLD_SECONDS": 0.05,
            "ALLOW_ESTIMATED_WORDS": False,
            "MAXIMUM_ESTIMATED_WORD_RATIO": 0.0,
        },
        status="experimental",
        performance_cost="low",
        quality_threshold="strict_native_or_fail",
    ),
)


def timing_preset(preset_id: str | None) -> TimingPreset | None:
    if not preset_id:
        return None
    for preset in TIMING_PRESETS:
        if preset.id == preset_id:
            return preset
    return None


def resolve_preset_pipeline_options(
    preset_id: str | None,
    explicit_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    preset = timing_preset(preset_id)
    if preset_id and preset is None:
        raise ValueError("unknown_timing_preset")
    base = deepcopy(preset.pipeline_options if preset else {})
    overrides = explicit_overrides if isinstance(explicit_overrides, dict) else {}
    return resolve_pipeline_config(_deep_merge(base, overrides)).to_dict()


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(base)
    for key, value in override.items():
        if value is None:
            continue
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def preset_compatibility(preset: TimingPreset, provider: str, model: str, *, timestamp_strategy: str) -> dict[str, Any]:
    if provider not in preset.provider_keys or model not in preset.model_keys:
        return {
            "state": "unsupported",
            "reason": "provider_model_not_supported",
        }
    options = preset.pipeline_options
    uses_stable_ts = bool((options.get("alignment") or {}).get("stableTsEnabled"))
    if uses_stable_ts and timestamp_strategy == "provider_word":
        return {
            "state": "compatible",
            "reason": None,
        }
    return {
        "state": "compatible",
        "reason": None,
    }


def public_preset_registry(catalog_entries: list[dict[str, Any]] | tuple[dict[str, Any], ...]) -> dict[str, Any]:
    presets = []
    for preset in TIMING_PRESETS:
        item = preset.to_public_dict()
        compatibilities: list[dict[str, Any]] = []
        for entry in catalog_entries:
            compatibility = preset_compatibility(
                preset,
                str(entry.get("provider") or ""),
                str(entry.get("model") or ""),
                timestamp_strategy=str(entry.get("timestampStrategy") or entry.get("timestamp_strategy") or ""),
            )
            if compatibility["state"] != "unsupported":
                compatibilities.append({
                    "provider": entry.get("provider"),
                    "model": entry.get("model"),
                    **compatibility,
                })
        item["compatibilities"] = compatibilities
        presets.append(item)
    return {
        "schemaVersion": 1,
        "fieldRanges": CONFIG_FIELD_RANGES,
        "envKeyToPath": {".".join(value): key for key, value in ENV_KEY_TO_PATH.items()},
        "presets": presets,
    }


def validate_preset_compatibility(
    preset_id: str | None,
    provider: str,
    model: str,
    *,
    timestamp_strategy: str,
) -> None:
    preset = timing_preset(preset_id)
    if preset is None:
        if preset_id:
            raise ValueError("unknown_timing_preset")
        return
    compatibility = preset_compatibility(preset, provider, model, timestamp_strategy=timestamp_strategy)
    if compatibility["state"] == "unsupported":
        raise ValueError(str(compatibility["reason"] or "preset_unsupported_for_provider_model"))
