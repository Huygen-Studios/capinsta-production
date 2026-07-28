from __future__ import annotations

import re
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

_FORBIDDEN_INPUT_KEY = re.compile(
    r"(signed.?url|service.?role|token|secret|bucket|object.?path|"
    r"filesystem|absolute.?path|ffprobe|flag|option|executable)",
    re.IGNORECASE,
)
_URL_OR_ABSOLUTE_PATH = re.compile(
    r"(^https?://|^file:|^[A-Za-z]:[\\/]|^/)", re.IGNORECASE
)


class ProbeContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _validate_safe_metadata(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if _FORBIDDEN_INPUT_KEY.search(str(key)):
                raise ValueError("metadata contains a forbidden probe-source field")
            _validate_safe_metadata(item)
    elif isinstance(value, list):
        for item in value:
            _validate_safe_metadata(item)
    elif isinstance(value, str) and _URL_OR_ABSOLUTE_PATH.search(value.strip()):
        raise ValueError("metadata must not contain a URL or absolute path")


class MediaProbeJobInputV1(ProbeContractModel):
    schemaVersion: Literal[1] = 1
    jobType: Literal["media_probe"] = "media_probe"
    mediaAssetId: UUID
    expectedMediaRevision: int = Field(ge=1)
    storageObjectRevision: int = Field(ge=1)
    requestedFields: None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def safe_metadata(self) -> "MediaProbeJobInputV1":
        _validate_safe_metadata(self.metadata)
        return self


class ProbeContainerV1(ProbeContractModel):
    formatName: str | None = Field(default=None, max_length=200)
    formatLongName: str | None = Field(default=None, max_length=200)
    bitRate: int | None = Field(default=None, ge=0)
    sizeBytes: int | None = Field(default=None, ge=0)


class ProbeVideoV1(ProbeContractModel):
    present: Literal[True] = True
    codecName: str | None = Field(default=None, max_length=100)
    codecLongName: str | None = Field(default=None, max_length=200)
    profile: str | None = Field(default=None, max_length=100)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    encodedWidth: int = Field(gt=0)
    encodedHeight: int = Field(gt=0)
    codedWidth: int | None = Field(default=None, gt=0)
    codedHeight: int | None = Field(default=None, gt=0)
    rotationDegrees: Literal[0, 90, 180, 270] = 0
    fpsNumerator: int | None = Field(default=None, gt=0)
    fpsDenominator: int | None = Field(default=None, gt=0)
    pixelFormat: str | None = Field(default=None, max_length=100)
    bitRate: int | None = Field(default=None, ge=0)
    streamIndex: int = Field(ge=0)

    @model_validator(mode="after")
    def fps_pair(self) -> "ProbeVideoV1":
        if (self.fpsNumerator is None) != (self.fpsDenominator is None):
            raise ValueError("FPS numerator and denominator must be paired")
        return self


class ProbeAudioV1(ProbeContractModel):
    present: Literal[True] = True
    codecName: str | None = Field(default=None, max_length=100)
    codecLongName: str | None = Field(default=None, max_length=200)
    sampleRateHz: int | None = Field(default=None, gt=0)
    channels: int | None = Field(default=None, gt=0)
    channelLayout: str | None = Field(default=None, max_length=100)
    bitRate: int | None = Field(default=None, ge=0)
    streamIndex: int = Field(ge=0)


class MediaProbeResultV1(ProbeContractModel):
    schemaVersion: Literal[1] = 1
    mediaAssetId: UUID
    mediaAssetRevision: int = Field(ge=1)
    mediaKind: Literal["video", "audio"]
    durationMs: int = Field(ge=0)
    container: ProbeContainerV1
    video: ProbeVideoV1 | None = None
    audio: ProbeAudioV1 | None = None
    streamCount: int = Field(ge=1, le=1024)
    warnings: list[str] = Field(default_factory=list, max_length=100)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def supported_stream(self) -> "MediaProbeResultV1":
        if self.mediaKind == "video" and self.video is None:
            raise ValueError("Video media requires a primary video stream")
        if self.mediaKind == "audio" and (
            self.video is not None or self.audio is None
        ):
            raise ValueError("Audio media requires only an audio primary stream")
        return self


__all__ = [
    "MediaProbeJobInputV1",
    "MediaProbeResultV1",
    "ProbeAudioV1",
    "ProbeContainerV1",
    "ProbeVideoV1",
]
