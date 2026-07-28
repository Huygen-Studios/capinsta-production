from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from server.clipping_handoff.contracts import ServerBackedMediaDescriptorV1
from server.clipping_persistence.errors import PersistenceError
from server.clipping_persistence.validation import ensure_portable_json


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PreviewRequestV1(StrictModel):
    expectedRevision: int = Field(ge=1)


class ExportOptionsV1(StrictModel):
    includeCaptions: Literal[True] = True


class ClippingExportRequestV1(StrictModel):
    schemaVersion: Literal[1] = 1
    expectedProjectRevision: int = Field(ge=1)
    preset: Literal["vertical-mp4-v1"] = "vertical-mp4-v1"
    options: ExportOptionsV1 = Field(default_factory=ExportOptionsV1)


class ClippingPreviewManifestV1(StrictModel):
    schemaVersion: Literal[1] = 1
    previewId: UUID
    clipProjectId: str = Field(min_length=1, max_length=200)
    clipProjectRevision: int = Field(ge=1)
    edlResultIdentity: str = Field(pattern=r"^[0-9a-f]{64}$")
    remappedTranscriptResultIdentity: str = Field(pattern=r"^[0-9a-f]{64}$")
    conversionResultIdentity: str = Field(pattern=r"^[0-9a-f]{64}$")
    capinstaProject: dict[str, Any]
    mediaAttachments: list[ServerBackedMediaDescriptorV1] = Field(
        min_length=1, max_length=100
    )
    durationMs: int = Field(ge=0)
    expiresAt: datetime
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def deterministic(self):
        if self.warnings != sorted(set(self.warnings)):
            raise ValueError("warnings must be unique and sorted")
        try:
            ensure_portable_json(self.model_dump(mode="json"))
        except PersistenceError as exc:
            raise ValueError("preview manifest contains private access data") from exc
        return self

    def bounded_json(self, maximum_bytes: int) -> dict[str, Any]:
        value = self.model_dump(mode="json")
        if (
            len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode())
            > maximum_bytes
        ):
            raise ValueError("preview manifest exceeds its configured limit")
        return value


class ClippingExportJobInputV1(StrictModel):
    schemaVersion: Literal[1] = 1
    exportId: UUID
    clipProjectId: str = Field(min_length=1, max_length=200)
    expectedProjectRevision: int = Field(ge=1)
    edlResultIdentity: str = Field(pattern=r"^[0-9a-f]{64}$")
    remappedTranscriptResultIdentity: str = Field(pattern=r"^[0-9a-f]{64}$")
    conversionResultIdentity: str = Field(pattern=r"^[0-9a-f]{64}$")
    exportSpecHash: str = Field(pattern=r"^[0-9a-f]{64}$")
    requestIdentity: str = Field(pattern=r"^[0-9a-f]{64}$")
