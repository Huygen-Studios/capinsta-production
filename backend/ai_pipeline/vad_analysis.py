import os
import hashlib
from dataclasses import dataclass, field
from typing import Any, Optional, ClassVar

def compute_file_sha256(file_path: str) -> str:
    h = hashlib.sha256()
    try:
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return f"{os.path.getsize(file_path)}_{os.path.getmtime(file_path)}"


@dataclass
class VADAnalysis:
    audio_fingerprint: str
    normalized_audio_asset_id: Optional[str]
    audio_path: str
    sample_rate: int
    speech_regions: list[dict[str, Any]]
    silence_regions: list[dict[str, Any]]
    padded_speech_ranges: list[dict[str, Any]]
    config_version: str
    diagnostic: dict[str, Any] = field(default_factory=dict)

    _global_cache: ClassVar[dict[tuple[str, str], "VADAnalysis"]] = {}

    @classmethod
    def get_cached_analysis(cls, fingerprint: str, config_version: str) -> Optional["VADAnalysis"]:
        return cls._global_cache.get((fingerprint, config_version))

    @classmethod
    def set_cached_analysis(cls, fingerprint: str, config_version: str, analysis: "VADAnalysis") -> None:
        cls._global_cache[(fingerprint, config_version)] = analysis

    @classmethod
    def get_cached_speech_map(cls, cache_key: tuple[Any, ...]) -> Optional[dict[str, Any]]:
        audio_path = cache_key[0]
        if not os.path.exists(audio_path):
            return None
        fingerprint = compute_file_sha256(audio_path)
        config_version = f"{cache_key[2]}_{cache_key[3]}_{cache_key[4]}_{cache_key[5]}_{cache_key[6]}"
        analysis = cls.get_cached_analysis(fingerprint, config_version)
        if analysis:
            return {
                "provider": "silero_vad",
                "sampleRate": analysis.sample_rate,
                "duration": analysis.diagnostic.get("duration", 0.0),
                "speechRanges": analysis.speech_regions,
                "rawSpeechRanges": analysis.speech_regions,
                "paddedSpeechRanges": analysis.padded_speech_ranges,
                "silenceGaps": analysis.silence_regions,
                "hardSpeechGaps": analysis.silence_regions,
                "audioDuration": analysis.diagnostic.get("audioDuration"),
                "pauseDetectionProvider": "silero",
                "pauseDetectionDegraded": False,
                "thresholdSeconds": analysis.diagnostic.get("thresholdSeconds"),
                "silero": analysis.diagnostic.get("silero", {}),
            }
        return None

    @classmethod
    def set_cached_speech_map(cls, cache_key: tuple[Any, ...], speech_map: dict[str, Any]) -> None:
        audio_path = cache_key[0]
        if not os.path.exists(audio_path):
            return
        fingerprint = compute_file_sha256(audio_path)
        config_version = f"{cache_key[2]}_{cache_key[3]}_{cache_key[4]}_{cache_key[5]}_{cache_key[6]}"
        analysis = VADAnalysis(
            audio_fingerprint=fingerprint,
            normalized_audio_asset_id=None,
            audio_path=audio_path,
            sample_rate=speech_map.get("sampleRate", 16000),
            speech_regions=speech_map.get("speechRanges") or speech_map.get("rawSpeechRanges") or [],
            silence_regions=speech_map.get("silenceGaps") or speech_map.get("hardSpeechGaps") or [],
            padded_speech_ranges=speech_map.get("paddedSpeechRanges") or [],
            config_version=config_version,
            diagnostic=speech_map,
        )
        cls.set_cached_analysis(fingerprint, config_version, analysis)

    @classmethod
    def clear_cache(cls) -> None:
        cls._global_cache.clear()
