from __future__ import annotations

import json
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _bounded_json(value: Any, *, maximum_bytes: int, field_name: str) -> None:
    try:
        size = len(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        )
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be JSON serializable") from exc
    if size > maximum_bytes:
        raise ValueError(f"{field_name} exceeds {maximum_bytes} bytes")


class CanvasInput(StrictModel):
    aspectRatio: Literal["9:16", "16:9", "1:1", "4:5", "custom"]
    width: int = Field(ge=64, le=8192)
    height: int = Field(ge=64, le=8192)
    background: str | None = Field(default=None, max_length=100)
    safeArea: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def bounded_values(self):
        _bounded_json(self.safeArea, maximum_bytes=8_192, field_name="safeArea")
        _bounded_json(self.metadata, maximum_bytes=16_384, field_name="canvas metadata")
        return self


class CreateProjectRequest(StrictModel):
    mediaAssetId: UUID
    transcriptId: str = Field(pattern=r"^tr_[A-Za-z0-9_-]{1,124}$")
    name: str = Field(min_length=1, max_length=120)
    canvas: CanvasInput
    initialRanges: list[dict[str, Any]] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def bounded_metadata(self):
        _bounded_json(self.metadata, maximum_bytes=32_768, field_name="metadata")
        return self


class UpdateProjectRequest(StrictModel):
    expectedRevision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    canvas: CanvasInput | None = None
    ranges: list[dict[str, Any]] | None = None
    metadata: dict[str, Any] | None = None

    @model_validator(mode="after")
    def has_change(self):
        if all(
            value is None
            for value in (self.name, self.canvas, self.ranges, self.metadata)
        ):
            raise ValueError("at least one project field must change")
        if self.metadata is not None:
            _bounded_json(self.metadata, maximum_bytes=32_768, field_name="metadata")
        return self


class RecommendationDecision(StrictModel):
    recommendationId: str = Field(pattern=r"^rec_[A-Za-z0-9_-]{1,124}$")
    decision: Literal["accepted", "rejected"]


class RecommendationDecisionRequest(StrictModel):
    expectedProjectRevision: int = Field(ge=1)
    decisions: list[RecommendationDecision] = Field(min_length=1, max_length=500)
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [item.recommendationId for item in self.decisions]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate recommendation ID")
        return self


class DraftOptions(StrictModel):
    includeAcceptedSilence: bool = True
    includeAcceptedFillers: bool = False
    minimumRangeDurationMs: int = Field(default=100, ge=1, le=60_000)


class DraftRequest(StrictModel):
    expectedProjectRevision: int = Field(ge=1)
    recommendationIds: list[str] | None = Field(default=None, max_length=5000)
    draftName: str | None = Field(default=None, min_length=1, max_length=120)
    options: DraftOptions = Field(default_factory=DraftOptions)

    @model_validator(mode="after")
    def unique_ids(self):
        if self.recommendationIds is not None:
            if len(self.recommendationIds) != len(set(self.recommendationIds)):
                raise ValueError("duplicate recommendation ID")
            if any(not item.startswith("rec_") for item in self.recommendationIds):
                raise ValueError("invalid recommendation ID")
        return self


class DeriveRequest(StrictModel):
    expectedRevision: int = Field(ge=1)
    includeRemappedTranscript: bool = True


class ConversionRequest(StrictModel):
    expectedRevision: int = Field(ge=1)
    targetProjectId: str = Field(min_length=1, max_length=160)
    includeCaptions: bool = True


class ProjectDerivationJobInputV1(StrictModel):
    schemaVersion: Literal[1] = 1
    jobType: Literal["project_derivation"] = "project_derivation"
    clipProjectId: str
    expectedRevision: int = Field(ge=1)
    transcriptId: str
    expectedTranscriptRevision: int = Field(ge=1)
    expectedMediaRevision: int = Field(ge=1)
    includeRemappedTranscript: bool
    requestIdentity: str = Field(pattern=r"^[0-9a-f]{64}$")
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProjectConversionRequestJobInputV1(StrictModel):
    schemaVersion: Literal[1] = 1
    jobType: Literal["project_conversion"] = "project_conversion"
    clipProjectId: str
    expectedRevision: int = Field(ge=1)
    targetProjectId: str
    includeCaptions: bool
    requestIdentity: str = Field(pattern=r"^[0-9a-f]{64}$")
    targetProjectSchemaVersion: Literal[35] = 35
    metadata: dict[str, Any] = Field(default_factory=dict)
