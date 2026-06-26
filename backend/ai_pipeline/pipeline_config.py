from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

TimingSourcePolicy = Literal["native_required", "native_then_forced", "forced", "estimated_debug_only"]


@dataclass(frozen=True)
class QualityConfig:
    minimumProviderTimestampCoverage: float = 0.90
    allowSegmentDerivedWords: bool = False
    allowEstimatedWords: bool = True
    maximumEstimatedWordRatio: float = 0.15


@dataclass(frozen=True)
class PerformanceConfig:
    providerTimeoutSeconds: int = 90
    sarvamMaxConcurrency: int = 1
    alignmentRetries: int = 3


@dataclass(frozen=True)
class CaptionChunkingConfig:
    targetWords: int = 4
    maxWords: int = 3
    minWords: int = 2
    maxCharacters: int = 28
    minDurationSeconds: float = 0.8
    maxDurationSeconds: float = 2.0
    pauseSplitThresholdSeconds: float = 0.25
    mergeGapSeconds: float = 0.12
    phraseHoldSeconds: float = 0.05


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
    allowStableTsOrderFallback: bool = True


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
    pauseThresholdSeconds: float = 0.25
    silenceThresholdDb: float | None = None
    sileroEnabled: bool = False
    sileroSpeechThreshold: float = 0.50
    speechMergeGapSeconds: float | None = None


@dataclass(frozen=True)
class AutoSyncConfig:
    enabled: bool = False
    frameStepSeconds: float = 0.02
    maxShiftSeconds: float = 2.0
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


def resolve_pipeline_config(value: dict[str, Any] | None = None) -> CaptionPipelineConfig:
    raw = value if isinstance(value, dict) else {}
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
        timingSourcePolicy=policy,  # type: ignore[arg-type]
        audio=AudioConfig(
            sampleRate=_int(audio.get("sampleRate"), 16000, 8000, 48000),
            channels=_int(audio.get("channels"), 1, 1, 2),
            codec=str(audio.get("codec") or "pcm_s16le"),
            bitrateKbps=None if audio.get("bitrateKbps") is None else _int(audio.get("bitrateKbps"), 128, 16, 512),
        ),
        audioChunking=AudioChunkingConfig(
            vadEnabled=_bool(chunking.get("vadEnabled"), True),
            targetSeconds=_num(chunking.get("targetSeconds"), 15.0, 3.0, 120.0),
            maxSeconds=_num(chunking.get("maxSeconds"), 25.0, 3.0, 180.0),
            paddingSeconds=_num(chunking.get("paddingSeconds"), 0.08, 0.0, 2.0),
            legacyNormalSeconds=_num(chunking.get("legacyNormalSeconds"), 20.0, 3.0, 120.0),
            legacyNormalOverlapSeconds=_num(chunking.get("legacyNormalOverlapSeconds"), 4.0, 0.0, 30.0),
            legacyStrictSeconds=_num(chunking.get("legacyStrictSeconds"), 12.0, 3.0, 120.0),
            legacyStrictOverlapSeconds=_num(chunking.get("legacyStrictOverlapSeconds"), 5.0, 0.0, 30.0),
            fadeMs=_int(chunking.get("fadeMs"), 0, 0, 1000),
        ),
        vad=VadConfig(
            pauseThresholdSeconds=_num(vad.get("pauseThresholdSeconds"), 0.30, 0.05, 3.0),
            silenceThresholdDb=None if vad.get("silenceThresholdDb") is None else _num(vad.get("silenceThresholdDb"), -35.0, -90.0, 0.0),
            sileroEnabled=_bool(vad.get("sileroEnabled"), False),
            sileroSpeechThreshold=_num(vad.get("sileroSpeechThreshold"), 0.50, 0.01, 0.99),
            speechMergeGapSeconds=None if vad.get("speechMergeGapSeconds") is None else _num(vad.get("speechMergeGapSeconds"), 0.08, 0.0, 2.0),
        ),
        alignment=AlignmentConfig(
            provider=str(alignment.get("provider") or "auto"),
            whisperxEnabled=_bool(alignment.get("whisperxEnabled"), False),
            stableTsEnabled=_bool(alignment.get("stableTsEnabled"), False),
            stableTsModel=str(alignment.get("stableTsModel") or "base"),
            stableTsDevice=str(alignment.get("stableTsDevice") or "auto"),
            stableTsMinMatchCoverage=_num(alignment.get("stableTsMinMatchCoverage"), 0.50, 0.0, 1.0),
            stableTsMinWordRatio=_num(alignment.get("stableTsMinWordRatio"), 0.45, 0.0, 10.0),
            stableTsMaxWordRatio=_num(alignment.get("stableTsMaxWordRatio"), 2.25, 0.1, 10.0),
            allowStableTsOrderFallback=_bool(alignment.get("allowStableTsOrderFallback"), False),
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
            maxShiftSeconds=_num(auto_sync.get("maxShiftSeconds"), 2.0, 0.0, 10.0),
            minScore=_num(auto_sync.get("minScore"), 0.58, 0.0, 1.0),
            minImprovement=_num(auto_sync.get("minImprovement"), 0.04, 0.0, 1.0),
            maxEstimatedWordRatio=_num(auto_sync.get("maxEstimatedWordRatio"), 0.70, 0.0, 1.0),
            allowSkew=_bool(auto_sync.get("allowSkew"), False),
            maxSkewDelta=_num(auto_sync.get("maxSkewDelta"), 0.02, 0.0, 1.0),
        ),
        captionChunking=CaptionChunkingConfig(
            targetWords=_int(caption.get("targetWords"), 4, 1, 20),
            maxWords=_int(caption.get("maxWords"), 5, 1, 24),
            minWords=_int(caption.get("minWords"), 2, 1, 12),
            maxCharacters=_int(caption.get("maxCharacters"), 36, 8, 120),
            minDurationSeconds=_num(caption.get("minDurationSeconds"), 0.8, 0.05, 10.0),
            maxDurationSeconds=_num(caption.get("maxDurationSeconds"), 3.0, 0.1, 30.0),
            pauseSplitThresholdSeconds=_num(caption.get("pauseSplitThresholdSeconds"), 0.30, 0.05, 3.0),
            mergeGapSeconds=_num(caption.get("mergeGapSeconds"), 0.12, 0.0, 3.0),
            phraseHoldSeconds=_num(caption.get("phraseHoldSeconds"), 0.12, 0.0, 3.0),
        ),
        quality=QualityConfig(
            minimumProviderTimestampCoverage=_num(quality.get("minimumProviderTimestampCoverage"), 0.90, 0.0, 1.0),
            allowSegmentDerivedWords=_bool(quality.get("allowSegmentDerivedWords"), False),
            allowEstimatedWords=_bool(quality.get("allowEstimatedWords"), False),
            maximumEstimatedWordRatio=_num(quality.get("maximumEstimatedWordRatio"), 0.15, 0.0, 1.0),
        ),
        performance=PerformanceConfig(
            providerTimeoutSeconds=_int(performance.get("providerTimeoutSeconds"), 60, 5, 600),
            sarvamMaxConcurrency=_int(performance.get("sarvamMaxConcurrency"), 2, 1, 8),
            alignmentRetries=_int(performance.get("alignmentRetries"), 3, 0, 10),
        ),
    )


DEFAULT_PIPELINE_OPTIONS = resolve_pipeline_config().to_dict()
