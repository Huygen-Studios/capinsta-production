from __future__ import annotations

import re
from typing import Any, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from ai_pipeline.language_modes import normalize_language_mode

_TRANSCRIPT_ID = re.compile(r"^tr_[A-Za-z0-9_-]{1,124}$")
_HASH = re.compile(r"^[0-9a-f]{64}$")
_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_FORBIDDEN_KEY = re.compile(
    r"(url|uri|token|secret|credential|api.?key|bucket|path|file|endpoint|"
    r"executable|argument|raw.?response|transcript)",
    re.IGNORECASE,
)
_URL_OR_PATH = re.compile(
    r"^(?:https?://|file:|/|\\\\|[A-Za-z]:[\\/])", re.IGNORECASE
)


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def sanitize_hotwords(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = " ".join(raw.split())
        if not value or len(value) > 100 or _CONTROL.search(value):
            raise ValueError(
                "hotword is empty, too long, or contains controls"
            )
        key = value.casefold()
        if key not in seen:
            result.append(value)
            seen.add(key)
    return result


def validate_safe_metadata(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if _FORBIDDEN_KEY.search(str(key)):
                raise ValueError("metadata contains a forbidden field")
            validate_safe_metadata(item)
    elif isinstance(value, list):
        if len(value) > 100:
            raise ValueError("metadata list is too large")
        for item in value:
            validate_safe_metadata(item)
    elif isinstance(value, str):
        if len(value) > 1000:
            raise ValueError("metadata string is too long")
        if _CONTROL.search(value) or _URL_OR_PATH.search(value):
            raise ValueError("metadata contains a URL, path, or control character")


class TranscriptionOptionsV1(ContractModel):
    wordTimestamps: Literal[True] = True
    speakerLabels: Literal[False] = False
    preserveFillers: Literal[True] = True


class TranscriptionJobInputV1(ContractModel):
    schemaVersion: Literal[1] = 1
    jobType: Literal["transcription"] = "transcription"
    mediaAssetId: UUID
    expectedMediaRevision: int = Field(ge=1)
    storageObjectRevision: int = Field(ge=1)
    audioVariantId: UUID
    audioVariantRevision: int = Field(ge=1)
    transcriptId: str
    requestIdentity: str
    languageMode: Literal[
        "auto",
        "english",
        "hindi",
        "telugu",
        "hinglish",
        "telgish",
        "auto_mixed_indian",
    ] = "auto"
    providerPreference: Literal["sarvam", "openai", "gemini"] | None = None
    hotwords: list[str] = Field(default_factory=list, max_length=100)
    options: TranscriptionOptionsV1 = Field(
        default_factory=TranscriptionOptionsV1
    )
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("transcriptId")
    @classmethod
    def valid_transcript_id(cls, value: str) -> str:
        if not _TRANSCRIPT_ID.fullmatch(value):
            raise ValueError("transcriptId is invalid")
        return value

    @field_validator("requestIdentity")
    @classmethod
    def valid_request_identity(cls, value: str) -> str:
        if not _HASH.fullmatch(value):
            raise ValueError("requestIdentity must be lowercase SHA-256")
        return value

    @field_validator("languageMode")
    @classmethod
    def canonical_language_mode(cls, value: str) -> str:
        return normalize_language_mode(value)

    @field_validator("hotwords")
    @classmethod
    def sanitize_hotwords(cls, values: list[str]) -> list[str]:
        return sanitize_hotwords(values)

    @model_validator(mode="after")
    def safe_metadata(self) -> "TranscriptionJobInputV1":
        validate_safe_metadata(self.metadata)
        return self


class ProviderSummaryV1(ContractModel):
    name: Literal["sarvam", "openai", "gemini", "groq_whisper"]
    model: str = Field(min_length=1, max_length=100)

    @field_validator("model")
    @classmethod
    def safe_model(cls, value: str) -> str:
        if not _SAFE_NAME.fullmatch(value):
            raise ValueError("provider model is invalid")
        return value


class LanguageSummaryV1(ContractModel):
    requestedMode: str = Field(min_length=1, max_length=50)
    detected: str | None = Field(default=None, max_length=50)


class TranscriptionJobResultV1(ContractModel):
    schemaVersion: Literal[1] = 1
    transcriptId: str
    mediaAssetId: UUID
    mediaRevision: int = Field(ge=1)
    audioVariantId: UUID
    provider: ProviderSummaryV1
    language: LanguageSummaryV1
    durationMs: int = Field(ge=0)
    segmentCount: int = Field(ge=0)
    wordCount: int = Field(ge=0)
    timedWordCount: int = Field(ge=0)
    untimedWordCount: int = Field(ge=0)
    speakerCount: int | None = Field(default=None, ge=0)
    timingSource: Literal[
        "provider",
        "aligned",
        "interpolated",
        "estimated",
        "manuallyAdjusted",
        "unknown",
        "mixed",
    ]
    warnings: list[str] = Field(default_factory=list, max_length=100)
    resultIdentity: str
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_result(self) -> "TranscriptionJobResultV1":
        if not _TRANSCRIPT_ID.fullmatch(self.transcriptId):
            raise ValueError("transcriptId is invalid")
        if not _HASH.fullmatch(self.resultIdentity):
            raise ValueError("resultIdentity must be lowercase SHA-256")
        if self.timedWordCount + self.untimedWordCount != self.wordCount:
            raise ValueError("word timing counts do not match wordCount")
        if self.speakerCount == 0:
            raise ValueError("speakerCount must be null when speakers are absent")
        if self.warnings != sorted(set(self.warnings)):
            raise ValueError("warnings must be sorted and unique")
        for warning in self.warnings:
            if not _SAFE_NAME.fullmatch(warning):
                raise ValueError("warning code is invalid")
        validate_safe_metadata(self.metadata)
        return self


__all__ = [
    "LanguageSummaryV1",
    "ProviderSummaryV1",
    "TranscriptionJobInputV1",
    "TranscriptionJobResultV1",
    "TranscriptionOptionsV1",
    "sanitize_hotwords",
    "validate_safe_metadata",
]
