from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_CLIP_DURATION_MS = 180_000


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateBatchRequest(StrictModel):
    sourceMediaAssetId: UUID
    title: str = Field(min_length=1, max_length=120)
    platformPreset: Literal["instagram_reels", "youtube_shorts", "tiktok", "custom"] = "instagram_reels"
    captionsEnabled: bool = False
    headingsEnabled: bool = False
    captionPreset: str | None = Field(default=None, max_length=80)
    maximumClipDurationMs: int = Field(default=MAX_CLIP_DURATION_MS, ge=1, le=MAX_CLIP_DURATION_MS)


class UpdateBatchRequest(StrictModel):
    expectedRevision: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    captionsEnabled: bool | None = None
    headingsEnabled: bool | None = None
    captionPreset: str | None = Field(default=None, max_length=80)
    platformPreset: Literal["instagram_reels", "youtube_shorts", "tiktok", "custom"] | None = None
    maximumClipDurationMs: int | None = Field(default=None, ge=1, le=MAX_CLIP_DURATION_MS)


class CreateItemRequest(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    sourceStartMs: int = Field(ge=0)
    sourceEndMs: int = Field(gt=0)

    @model_validator(mode="after")
    def valid_range(self):
        duration = self.sourceEndMs - self.sourceStartMs
        if duration <= 0 or duration > MAX_CLIP_DURATION_MS:
            raise ValueError("clip range must be between 1 and 180000 milliseconds")
        return self


class UpdateItemRequest(StrictModel):
    expectedRevision: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    sourceStartMs: int | None = Field(default=None, ge=0)
    sourceEndMs: int | None = Field(default=None, gt=0)
    selectedForExport: bool | None = None


class ReorderItemsRequest(StrictModel):
    expectedBatchRevision: int = Field(ge=1)
    itemIds: list[UUID] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def unique_items(self):
        if len(self.itemIds) != len(set(self.itemIds)):
            raise ValueError("duplicate item ID")
        return self


class MaterializeRequest(StrictModel):
    expectedRevision: int = Field(ge=1)


class CaptionRequest(StrictModel):
    itemId: UUID
    languageMode: Literal["auto", "english", "hindi", "telugu", "hinglish", "telgish", "auto_mixed_indian"] = "auto"


class BatchExportRequest(StrictModel):
    itemIds: list[UUID] | None = Field(default=None, min_length=1, max_length=50)

    @model_validator(mode="after")
    def unique_items(self):
        if self.itemIds is not None and len(self.itemIds) != len(set(self.itemIds)):
            raise ValueError("duplicate item ID")
        return self


class SyncEditorProjectRequest(StrictModel):
    expectedItemRevision: int = Field(ge=1)
    project: dict[str, Any]

    @model_validator(mode="after")
    def valid_project(self):
        if self.project.get("version") != 35 or not isinstance(self.project.get("metadata"), dict):
            raise ValueError("editor project must use schema version 35")
        return self
