from __future__ import annotations

from dataclasses import asdict, dataclass, field
import os
from typing import Any, Literal

TimingSourcePolicy = Literal["native_required", "native_then_forced", "forced", "estimated_debug_only"]


@dataclass(frozen=True)
class QualityConfig:
    minimumProviderTimestampCoverage: float = 0.90
    allowSegmentDerivedWords: bool = False
    allowEstimatedWords: bool = True
    maximumEstimatedWordRatio: float | None = None


@dataclass(frozen=True)
class PerformanceConfig:
    providerTimeoutSeconds: int = 90
    sarvamMaxConcurrency: int = 1
    alignmentRetries: int = 3
    stableTsMaxAudioSeconds: float = 45.0


@dataclass(frozen=True)
class CaptionChunkingConfig:
    targetWords: int = 4
    maxWords: int = 3
    minWords: int = 2
    maxCharacters: int = 28
    minDurationSeconds: float = 0.8
    maxDurationSeconds: float = 2.0
    pauseSplitThresholdSeconds: float = 0.36
    mergeGapSeconds: float = 0.12
    phraseHoldSeconds: float = 0.25


@dataclass(frozen=True)
class AlignmentConfig:
    provider: str = "auto"
    whisperxEnabled: bool = False
    stableTsEnabled: bool = True
    stableTsModel: str = "small"
    stableTsDevice: str = "auto"
    stableTsMinMatchCoverage: float = 0.50
    stableTsMinWordRatio: float = 0.45
    stableTsMaxWordRatio: float = 2.25
    allowStableTsOrderFallback: bool = False
    stableTsFallbackEnabled: bool = True
    whisperxFallbackEnabled: bool = False


@dataclass(frozen=True)
class RepairConfig:
    speechSpanRetimerEnabled: bool = True
    minimumWordDurationSeconds: float = 0.04
    minimumInterWordGapSeconds: float = 0.0
    cadenceMinSeconds: float = 0.075
    cadenceMaxSeconds: float = 0.35
    minimumSpeechRetimeWords: int = 6
    minimumSpeechRetimeTrailingGapSeconds: float = 1.0
    speechRetimeCompressionRatio: float = 0.78
    minimumPhraseRetimeWords: int = 4


@dataclass(frozen=True)
class AudioChunkingConfig:
    vadEnabled: bool = True
    targetSeconds: float = 8.0
    maxSeconds: float = 12.0
    paddingSeconds: float = 0.18
    legacyNormalSeconds: float = 20.0
    legacyNormalOverlapSeconds: float = 4.0
    legacyStrictSeconds: float = 12.0
    legacyStrictOverlapSeconds: float = 5.0
    fadeMs: int = 0


@dataclass(frozen=True)
class VadConfig:
    pauseThresholdSeconds: float = 0.36
    silenceThresholdDb: float | None = None
    sileroEnabled: bool = True
    sileroSpeechThreshold: float = 0.50
    sileroMinSpeechDurationMs: int = 80
    sileroMinSilenceDurationMs: int = 180
    sileroSpeechPadMs: int = 30
    speechMergeGapSeconds: float | None = None


@dataclass(frozen=True)
class AutoSyncConfig:
    enabled: bool = False
    frameStepSeconds: float = 0.02
    maxShiftSeconds: float = 0.8
    minScore: float = 0.58
    minImprovement: float = 0.04
    maxEstimatedWordRatio: float = 0.70
    allowSkew: bool = False
    maxSkewDelta: float = 0.02


@dataclass(frozen=True)
class AudioConfig:
    sampleRate: int = 16000
    channels: int = 1
    codec: str = "pcm_s16le"
    bitrateKbps: int | None = None


@dataclass(frozen=True)
class CaptionPipelineConfig:
    schemaVersion: int = 1
    preset: str = "fast"
    timingSourcePolicy: TimingSourcePolicy = "native_then_forced"
    audio: AudioConfig = field(default_factory=AudioConfig)
    audioChunking: AudioChunkingConfig = field(default_factory=AudioChunkingConfig)
    vad: VadConfig = field(default_factory=VadConfig)
    alignment: AlignmentConfig = field(default_factory=AlignmentConfig)
    repair: RepairConfig = field(default_factory=RepairConfig)
    autoSync: AutoSyncConfig = field(default_factory=AutoSyncConfig)
    captionChunking: CaptionChunkingConfig = field(default_factory=CaptionChunkingConfig)
    quality: QualityConfig = field(default_factory=QualityConfig)
    performance: PerformanceConfig = field(default_factory=PerformanceConfig)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _section(raw: dict[str, Any], key: str) -> dict[str, Any]:
    value = raw.get(key)
    return value if isinstance(value, dict) else {}


def _num(value: Any, default: float, minimum: float, maximum: float) -> float:
    if value is None:
        return default
    parsed = float(value)
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"value_out_of_range:{parsed}")
    return parsed


def _int(value: Any, default: int, minimum: int, maximum: int) -> int:
    return int(_num(value, default, minimum, maximum))


def _bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    return default


def _env_value(name: str) -> str | None:
    value = os.getenv(name)
    if value is None or value == "":
        return None
    return value


def _env_bool(name: str, default: bool) -> bool | None:
    value = _env_value(name)
    if value is None:
        return None
    return _bool(value, default)


def _env_num(name: str) -> float | None:
    value = _env_value(name)
    if value is None:
        return None
    if value.strip().lower() == "adaptive":
        return None
    return float(value)


def _env_str(name: str) -> str | None:
    return _env_value(name)


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if value is None:
            continue
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


PRESET_DEFAULTS = {
    "fast": {
        "audioChunking": {
            "vadEnabled": True,
            "targetSeconds": 24.0,
            "maxSeconds": 28.0,
            "paddingSeconds": 0.18,
        },
        "performance": {
            "sarvamMaxConcurrency": 4,
        },
        "alignment": {
            "whisperxEnabled": False,
            "stableTsEnabled": False,
            "stableTsFallbackEnabled": False,
            "whisperxFallbackEnabled": False,
        }
    },
    "balanced": {
        "audioChunking": {
            "vadEnabled": True,
            "targetSeconds": 24.0,
            "maxSeconds": 28.0,
            "paddingSeconds": 0.18,
        },
        "performance": {
            "sarvamMaxConcurrency": 4,
        },
        "alignment": {
            "whisperxEnabled": False,
            "stableTsEnabled": False,
            "stableTsFallbackEnabled": True,
            "whisperxFallbackEnabled": False,
        }
    },
    "quality": {
        "audioChunking": {
            "vadEnabled": True,
            "targetSeconds": 24.0,
            "maxSeconds": 28.0,
            "paddingSeconds": 0.18,
        },
        "performance": {
            "sarvamMaxConcurrency": 4,
        },
        "alignment": {
            "whisperxEnabled": False,
            "stableTsEnabled": False,
            "stableTsFallbackEnabled": True,
            "whisperxFallbackEnabled": True,
        }
    },
    "accurate": {
        "audioChunking": {
            "vadEnabled": True,
            "targetSeconds": 8.0,
            "maxSeconds": 12.0,
            "paddingSeconds": 0.18,
        },
        "performance": {
            "sarvamMaxConcurrency": 2,
        },
        "alignment": {
            "whisperxEnabled": False,
            "stableTsEnabled": True,
            "stableTsFallbackEnabled": True,
            "whisperxFallbackEnabled": True,
        }
    }
}


def environment_pipeline_options() -> dict[str, Any]:
    options: dict[str, Any] = {}

    def set_path(section: str, key: str, value: Any) -> None:
        if value is None:
            return
        options.setdefault(section, {})[key] = value

    preset = _env_str("CAPTION_DEFAULT_PRESET")
    if preset:
        options["preset"] = preset

    policy = _env_str("TIMING_SOURCE_POLICY")
    if policy:
        options["timingSourcePolicy"] = policy
    set_path("audioChunking", "targetSeconds", _env_num("CAPTION_TARGET_CHUNK_SECONDS") or _env_num("VAD_TARGET_SECONDS"))
    set_path("audioChunking", "maxSeconds", _env_num("CAPTION_MAX_CHUNK_SECONDS") or _env_num("VAD_MAX_SECONDS"))
    set_path("audioChunking", "paddingSeconds", _env_num("CHUNK_PADDING_SECONDS"))
    set_path("audioChunking", "vadEnabled", _env_bool("USE_VAD_CHUNKING", True))
    set_path("vad", "pauseThresholdSeconds", _env_num("PAUSE_SPLIT_SECONDS"))
    if _env_value("SILENCE_THRESHOLD_DB") and _env_value("SILENCE_THRESHOLD_DB").strip().lower() != "adaptive":
        set_path("vad", "silenceThresholdDb", _env_num("SILENCE_THRESHOLD_DB"))
    set_path("vad", "sileroEnabled", _env_bool("ENABLE_SILERO_VAD", True))
    set_path("vad", "sileroSpeechThreshold", _env_num("SILERO_THRESHOLD"))
    set_path("vad", "sileroMinSpeechDurationMs", _env_num("SILERO_MIN_SPEECH_DURATION_MS"))
    set_path("vad", "sileroMinSilenceDurationMs", _env_num("SILERO_MIN_SILENCE_DURATION_MS"))
    set_path("vad", "sileroSpeechPadMs", _env_num("SILERO_SPEECH_PAD_MS"))
    set_path("alignment", "stableTsEnabled", _env_bool("ENABLE_STABLE_TS", True))
    set_path("alignment", "stableTsModel", _env_str("STABLE_TS_MODEL"))
    set_path("alignment", "stableTsMinMatchCoverage", _env_num("STABLE_TS_MIN_MATCH_COVERAGE") or _env_num("MIN_MATCH_COVERAGE"))
    set_path("alignment", "stableTsMinWordRatio", _env_num("STABLE_TS_MIN_WORD_RATIO"))
    set_path("alignment", "stableTsMaxWordRatio", _env_num("STABLE_TS_MAX_WORD_RATIO"))
    set_path("alignment", "allowStableTsOrderFallback", _env_bool("ALLOW_STABLE_TS_ORDER_FALLBACK", False))
    set_path("alignment", "stableTsFallbackEnabled", _env_bool("STABLE_TS_FALLBACK_ENABLED", True))
    set_path("alignment", "whisperxFallbackEnabled", _env_bool("WHISPERX_FALLBACK_ENABLED", False))
    set_path("autoSync", "enabled", _env_bool("ENABLE_AUTO_GLOBAL_SYNC", False))
    set_path("autoSync", "maxShiftSeconds", _env_num("MAX_SHIFT_SECONDS"))
    set_path("autoSync", "minScore", _env_num("MIN_SYNC_SCORE"))
    set_path("autoSync", "allowSkew", _env_bool("ALLOW_SPEED_SKEW_CORRECTION", False))
    set_path("autoSync", "maxSkewDelta", _env_num("MAX_SKEW_DELTA"))
    set_path("captionChunking", "maxWords", _env_num("CAPTION_MAX_WORDS"))
    set_path("captionChunking", "maxCharacters", _env_num("CAPTION_MAX_CHARS"))
    set_path("captionChunking", "maxDurationSeconds", _env_num("MAX_DURATION_SECONDS"))
    set_path("captionChunking", "pauseSplitThresholdSeconds", _env_num("PAUSE_SPLIT_SECONDS"))
    set_path("captionChunking", "phraseHoldSeconds", _env_num("PHRASE_HOLD_SECONDS"))
    set_path("performance", "providerTimeoutSeconds", _env_num("PROVIDER_TIMEOUT_SECONDS"))
    set_path("performance", "sarvamMaxConcurrency", _env_num("SARVAM_MAX_CONCURRENCY_PER_JOB") or _env_num("SARVAM_CONCURRENCY"))
    set_path("quality", "allowEstimatedWords", _env_bool("ALLOW_ESTIMATED_WORDS", True))
    return options


def resolve_pipeline_config(value: dict[str, Any] | None = None) -> CaptionPipelineConfig:
    # 1. Determine preset name
    val_preset = (value or {}).get("preset") if isinstance(value, dict) else None
    preset_name = str(val_preset or _env_str("CAPTION_DEFAULT_PRESET") or "fast").lower()
    if preset_name not in {"fast", "balanced", "quality", "accurate"}:
        preset_name = "fast"

    # 2. Get preset defaults, then merge env options, then merge value
    preset_defaults = PRESET_DEFAULTS[preset_name]
    env_options = environment_pipeline_options()
    raw = _deep_merge(preset_defaults, env_options)
    raw = _deep_merge(raw, value if isinstance(value, dict) else {})
    raw["preset"] = preset_name

    policy = str(raw.get("timingSourcePolicy") or "native_then_forced")
    if policy not in {"native_required", "native_then_forced", "forced", "estimated_debug_only"}:
        raise ValueError("invalid_timing_source_policy")
    quality = _section(raw, "quality")
    performance = _section(raw, "performance")
    caption = _section(raw, "captionChunking")
    alignment = _section(raw, "alignment")
    repair = _section(raw, "repair")
    chunking = _section(raw, "audioChunking")
    vad = _section(raw, "vad")
    auto_sync = _section(raw, "autoSync")
    audio = _section(raw, "audio")

    return CaptionPipelineConfig(
        schemaVersion=_int(raw.get("schemaVersion"), 1, 1, 100),
        preset=preset_name,
        timingSourcePolicy=policy,  # type: ignore[arg-type]
        audio=AudioConfig(
            sampleRate=_int(audio.get("sampleRate"), 16000, 8000, 48000),
            channels=_int(audio.get("channels"), 1, 1, 2),
            codec=str(audio.get("codec") or "pcm_s16le"),
            bitrateKbps=None if audio.get("bitrateKbps") is None else _int(audio.get("bitrateKbps"), 128, 16, 512),
        ),
        audioChunking=AudioChunkingConfig(
            vadEnabled=_bool(chunking.get("vadEnabled"), True),
            targetSeconds=_num(chunking.get("targetSeconds"), AudioChunkingConfig.targetSeconds, 3.0, 120.0),
            maxSeconds=_num(chunking.get("maxSeconds"), AudioChunkingConfig.maxSeconds, 3.0, 180.0),
            paddingSeconds=_num(chunking.get("paddingSeconds"), AudioChunkingConfig.paddingSeconds, 0.0, 2.0),
            legacyNormalSeconds=_num(chunking.get("legacyNormalSeconds"), 20.0, 3.0, 120.0),
            legacyNormalOverlapSeconds=_num(chunking.get("legacyNormalOverlapSeconds"), 4.0, 0.0, 30.0),
            legacyStrictSeconds=_num(chunking.get("legacyStrictSeconds"), 12.0, 3.0, 120.0),
            legacyStrictOverlapSeconds=_num(chunking.get("legacyStrictOverlapSeconds"), 5.0, 0.0, 30.0),
            fadeMs=_int(chunking.get("fadeMs"), 0, 0, 1000),
        ),
        vad=VadConfig(
            pauseThresholdSeconds=_num(vad.get("pauseThresholdSeconds"), VadConfig.pauseThresholdSeconds, 0.05, 3.0),
            silenceThresholdDb=None if vad.get("silenceThresholdDb") is None else _num(vad.get("silenceThresholdDb"), -35.0, -90.0, 0.0),
            sileroEnabled=_bool(vad.get("sileroEnabled"), VadConfig.sileroEnabled),
            sileroSpeechThreshold=_num(vad.get("sileroSpeechThreshold"), 0.50, 0.01, 0.99),
            sileroMinSpeechDurationMs=_int(vad.get("sileroMinSpeechDurationMs"), VadConfig.sileroMinSpeechDurationMs, 0, 2000),
            sileroMinSilenceDurationMs=_int(vad.get("sileroMinSilenceDurationMs"), VadConfig.sileroMinSilenceDurationMs, 0, 3000),
            sileroSpeechPadMs=_int(vad.get("sileroSpeechPadMs"), VadConfig.sileroSpeechPadMs, 0, 1000),
            speechMergeGapSeconds=None if vad.get("speechMergeGapSeconds") is None else _num(vad.get("speechMergeGapSeconds"), 0.08, 0.0, 2.0),
        ),
        alignment=AlignmentConfig(
            provider=str(alignment.get("provider") or "auto"),
            whisperxEnabled=_bool(alignment.get("whisperxEnabled"), False),
            stableTsEnabled=_bool(alignment.get("stableTsEnabled"), AlignmentConfig.stableTsEnabled),
            stableTsModel=str(alignment.get("stableTsModel") or AlignmentConfig.stableTsModel),
            stableTsDevice=str(alignment.get("stableTsDevice") or "auto"),
            stableTsMinMatchCoverage=_num(alignment.get("stableTsMinMatchCoverage"), 0.50, 0.0, 1.0),
            stableTsMinWordRatio=_num(alignment.get("stableTsMinWordRatio"), 0.45, 0.0, 10.0),
            stableTsMaxWordRatio=_num(alignment.get("stableTsMaxWordRatio"), 2.25, 0.1, 10.0),
            allowStableTsOrderFallback=_bool(alignment.get("allowStableTsOrderFallback"), AlignmentConfig.allowStableTsOrderFallback),
            stableTsFallbackEnabled=_bool(alignment.get("stableTsFallbackEnabled"), True),
            whisperxFallbackEnabled=_bool(alignment.get("whisperxFallbackEnabled"), False),
        ),
        repair=RepairConfig(
            speechSpanRetimerEnabled=_bool(repair.get("speechSpanRetimerEnabled"), True),
            minimumWordDurationSeconds=_num(repair.get("minimumWordDurationSeconds"), 0.04, 0.005, 1.0),
            minimumInterWordGapSeconds=_num(repair.get("minimumInterWordGapSeconds"), 0.0, 0.0, 0.5),
            cadenceMinSeconds=_num(repair.get("cadenceMinSeconds"), 0.075, 0.01, 1.0),
            cadenceMaxSeconds=_num(repair.get("cadenceMaxSeconds"), 0.35, 0.02, 3.0),
            minimumSpeechRetimeWords=_int(repair.get("minimumSpeechRetimeWords"), 6, 1, 100),
            minimumSpeechRetimeTrailingGapSeconds=_num(repair.get("minimumSpeechRetimeTrailingGapSeconds"), 1.0, 0.0, 10.0),
            speechRetimeCompressionRatio=_num(repair.get("speechRetimeCompressionRatio"), 0.78, 0.01, 2.0),
            minimumPhraseRetimeWords=_int(repair.get("minimumPhraseRetimeWords"), 4, 1, 100),
        ),
        autoSync=AutoSyncConfig(
            enabled=_bool(auto_sync.get("enabled"), False),
            frameStepSeconds=_num(auto_sync.get("frameStepSeconds"), 0.02, 0.001, 0.5),
            maxShiftSeconds=_num(auto_sync.get("maxShiftSeconds"), AutoSyncConfig.maxShiftSeconds, 0.0, 10.0),
            minScore=_num(auto_sync.get("minScore"), 0.58, 0.0, 1.0),
            minImprovement=_num(auto_sync.get("minImprovement"), 0.04, 0.0, 1.0),
            maxEstimatedWordRatio=_num(auto_sync.get("maxEstimatedWordRatio"), 0.70, 0.0, 1.0),
            allowSkew=_bool(auto_sync.get("allowSkew"), False),
            maxSkewDelta=_num(auto_sync.get("maxSkewDelta"), 0.02, 0.0, 1.0),
        ),
        captionChunking=CaptionChunkingConfig(
            targetWords=_int(caption.get("targetWords"), 4, 1, 20),
            maxWords=_int(caption.get("maxWords"), CaptionChunkingConfig.maxWords, 1, 24),
            minWords=_int(caption.get("minWords"), 2, 1, 12),
            maxCharacters=_int(caption.get("maxCharacters"), CaptionChunkingConfig.maxCharacters, 8, 120),
            minDurationSeconds=_num(caption.get("minDurationSeconds"), 0.8, 0.05, 10.0),
            maxDurationSeconds=_num(caption.get("maxDurationSeconds"), CaptionChunkingConfig.maxDurationSeconds, 0.1, 30.0),
            pauseSplitThresholdSeconds=_num(caption.get("pauseSplitThresholdSeconds"), CaptionChunkingConfig.pauseSplitThresholdSeconds, 0.05, 3.0),
            mergeGapSeconds=_num(caption.get("mergeGapSeconds"), 0.12, 0.0, 3.0),
            phraseHoldSeconds=_num(caption.get("phraseHoldSeconds"), CaptionChunkingConfig.phraseHoldSeconds, 0.0, 3.0),
        ),
        quality=QualityConfig(
            minimumProviderTimestampCoverage=_num(quality.get("minimumProviderTimestampCoverage"), 0.90, 0.0, 1.0),
            allowSegmentDerivedWords=_bool(quality.get("allowSegmentDerivedWords"), False),
            allowEstimatedWords=_bool(quality.get("allowEstimatedWords"), QualityConfig.allowEstimatedWords),
            maximumEstimatedWordRatio=(
                _num(quality.get("maximumEstimatedWordRatio"), 0.0, 0.0, 1.0)
                if quality.get("maximumEstimatedWordRatio") is not None
                else None
            ),
        ),
        performance=PerformanceConfig(
            providerTimeoutSeconds=_int(performance.get("providerTimeoutSeconds"), PerformanceConfig.providerTimeoutSeconds, 5, 600),
            sarvamMaxConcurrency=_int(performance.get("sarvamMaxConcurrency"), PerformanceConfig.sarvamMaxConcurrency, 1, 8),
            alignmentRetries=_int(performance.get("alignmentRetries"), 3, 0, 10),
            stableTsMaxAudioSeconds=_num(performance.get("stableTsMaxAudioSeconds"), PerformanceConfig.stableTsMaxAudioSeconds, 1.0, 3600.0),
        ),
    )


def resolve_pipeline_config_with_sources(value: dict[str, Any] | None = None) -> dict[str, Any]:
    env_options = environment_pipeline_options()
    resolved = resolve_pipeline_config(value).to_dict()
    snapshot = value if isinstance(value, dict) else {}
    sources: dict[str, Any] = {}

    def walk(node: dict[str, Any], path: tuple[str, ...] = ()) -> None:
        for key, child in node.items():
            child_path = (*path, key)
            if isinstance(child, dict):
                walk(child, child_path)
                continue
            cursor_snapshot: Any = snapshot
            cursor_env: Any = env_options
            for part in child_path:
                cursor_snapshot = cursor_snapshot.get(part) if isinstance(cursor_snapshot, dict) else None
                cursor_env = cursor_env.get(part) if isinstance(cursor_env, dict) else None
            target = sources
            for part in child_path[:-1]:
                target = target.setdefault(part, {})
            target[child_path[-1]] = "snapshot" if cursor_snapshot is not None else "environment" if cursor_env is not None else "default"

    walk(resolved)
    return {"resolved": resolved, "sources": sources}


DEFAULT_PIPELINE_OPTIONS = resolve_pipeline_config().to_dict()
