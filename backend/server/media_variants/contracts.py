from __future__ import annotations

import re
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

_HASH = re.compile(r"^[0-9a-f]{64}$")
_FORBIDDEN = re.compile(
    r"(url|token|secret|credential|bucket|path|ffmpeg|argument|filter)",
    re.IGNORECASE,
)


class VariantContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _safe_metadata(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if _FORBIDDEN.search(str(key)):
                raise ValueError("metadata contains a forbidden field")
            _safe_metadata(item)
    elif isinstance(value, list):
        for item in value:
            _safe_metadata(item)
    elif isinstance(value, str) and (
        value.startswith(("http://", "https://", "file:", "/", "\\"))
        or re.match(r"^[A-Za-z]:[\\/]", value)
    ):
        raise ValueError("metadata contains a URL or absolute path")


class MediaVariantJobInputV1(VariantContractModel):
    schemaVersion: Literal[1] = 1
    mediaAssetId: UUID
    expectedMediaRevision: int = Field(ge=1)
    storageObjectRevision: int = Field(ge=1)
    variantId: UUID
    generationSpecHash: str
    preset: str = Field(min_length=1, max_length=100)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_hash_and_metadata(self) -> "MediaVariantJobInputV1":
        if not _HASH.fullmatch(self.generationSpecHash):
            raise ValueError("generationSpecHash must be lowercase SHA-256")
        _safe_metadata(self.metadata)
        return self


class ProxyGenerationJobInputV1(MediaVariantJobInputV1):
    jobType: Literal["proxy_generation"] = "proxy_generation"
    preset: Literal["editing-720p-v1"] = "editing-720p-v1"


class AudioExtractionJobInputV1(MediaVariantJobInputV1):
    jobType: Literal["audio_extraction"] = "audio_extraction"
    preset: Literal["transcription-wav-16k-mono-v1"] = (
        "transcription-wav-16k-mono-v1"
    )


class ThumbnailGenerationJobInputV1(MediaVariantJobInputV1):
    jobType: Literal["thumbnail_generation"] = "thumbnail_generation"
    preset: Literal["poster-jpeg-v1"] = "poster-jpeg-v1"


class WaveformGenerationJobInputV1(MediaVariantJobInputV1):
    jobType: Literal["waveform_generation"] = "waveform_generation"
    preset: Literal["waveform-peaks-v1"] = "waveform-peaks-v1"


class VariantResultV1(VariantContractModel):
    schemaVersion: Literal[1] = 1
    mediaAssetId: UUID
    mediaVariantId: UUID
    variantType: Literal["proxy", "audio_extract", "thumbnail", "waveform"]
    sourceMediaRevision: int = Field(ge=1)
    sourceStorageObjectRevision: int = Field(ge=1)
    generationSpecHash: str = Field(pattern=r"^[0-9a-f]{64}$")
    storageBucket: str = Field(min_length=1, max_length=100)
    storagePath: str = Field(min_length=1, max_length=1000)
    mimeType: str = Field(min_length=1, max_length=200)
    sizeBytes: int = Field(ge=1)
    checksum: str | None = Field(default=None, max_length=200)
    durationMs: int | None = Field(default=None, ge=0)
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)
    technicalMetadata: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list, max_length=100)


class ProxyGenerationResultV1(VariantResultV1):
    variantType: Literal["proxy"] = "proxy"


class AudioExtractionResultV1(VariantResultV1):
    variantType: Literal["audio_extract"] = "audio_extract"


class ThumbnailGenerationResultV1(VariantResultV1):
    variantType: Literal["thumbnail"] = "thumbnail"


class WaveformGenerationResultV1(VariantResultV1):
    variantType: Literal["waveform"] = "waveform"


class WaveformArtifactV1(VariantContractModel):
    schemaVersion: Literal[1] = 1
    mediaAssetId: UUID
    sourceMediaRevision: int = Field(ge=1)
    durationMs: int = Field(ge=0)
    sampleRateHz: Literal[16000] = 16000
    channelMode: Literal["mono"] = "mono"
    bucketDurationMs: int = Field(ge=1)
    peakEncoding: Literal["signed-int16-min-max"] = "signed-int16-min-max"
    peaks: list[tuple[int, int]]

    @model_validator(mode="after")
    def validate_peaks(self) -> "WaveformArtifactV1":
        for minimum, maximum in self.peaks:
            if not (-32768 <= minimum <= maximum <= 32767):
                raise ValueError("waveform peak is outside signed int16 range")
        return self


__all__ = [
    "AudioExtractionJobInputV1",
    "AudioExtractionResultV1",
    "MediaVariantJobInputV1",
    "ProxyGenerationJobInputV1",
    "ProxyGenerationResultV1",
    "ThumbnailGenerationJobInputV1",
    "ThumbnailGenerationResultV1",
    "VariantResultV1",
    "WaveformArtifactV1",
    "WaveformGenerationJobInputV1",
    "WaveformGenerationResultV1",
]
