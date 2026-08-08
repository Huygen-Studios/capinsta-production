from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from server.clipping_persistence.errors import PersistenceError
from server.clipping_persistence.validation import ensure_portable_json


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HandoffOptionsV1(StrictModel):
    includeCaptions: bool = True


class PrepareHandoffRequestV1(StrictModel):
    expectedRevision: int = Field(ge=1)
    targetProjectId: str = Field(
        min_length=1,
        max_length=200,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    options: HandoffOptionsV1 = Field(default_factory=HandoffOptionsV1)


class CompleteHandoffRequestV1(StrictModel):
    importedProjectId: str = Field(min_length=1, max_length=200)
    importedProjectRevision: int = Field(ge=1)


class ServerBackedMediaDescriptorV1(StrictModel):
    schemaVersion: Literal[1] = 1
    mediaId: str = Field(min_length=1, max_length=200)
    mediaAssetId: UUID
    sourceType: Literal["server-backed"] = "server-backed"
    mediaKind: Literal["video", "audio", "image", "unknown"]
    mimeType: str | None = Field(default=None, max_length=100)
    displayName: str = Field(min_length=1, max_length=255)
    sizeBytes: int | None = Field(default=None, ge=0)
    durationMs: int = Field(ge=0)
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)
    storageProvider: Literal["supabase"] = "supabase"
    accessMode: Literal["authenticated-server-backed"] = (
        "authenticated-server-backed"
    )
    requiresBrowserPersistence: Literal[False] = False


class HandoffProvenanceV1(StrictModel):
    sourceClipProjectId: str
    sourceClipProjectRevision: int = Field(ge=1)
    conversionSchemaVersion: Literal[1] = 1
    convertedAt: None = None


class CapinstaProjectHandoffManifestV1(StrictModel):
    schemaVersion: Literal[1] = 1
    handoffId: UUID
    clipProjectId: str
    clipProjectRevision: int = Field(ge=1)
    conversionResultIdentity: str = Field(pattern=r"^[0-9a-f]{64}$")
    targetProjectId: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    projectSchemaVersion: Literal[35] = 35
    project: dict[str, Any]
    mediaAttachments: list[ServerBackedMediaDescriptorV1] = Field(
        min_length=1, max_length=100
    )
    provenance: HandoffProvenanceV1
    expiresAt: datetime
    warnings: list[str] = Field(default_factory=list, max_length=1000)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_project_and_media(self):
        project_id = (self.project.get("metadata") or {}).get("id")
        scenes = self.project.get("scenes")
        settings = self.project.get("settings") or {}
        canvas = settings.get("canvasSize") or {}
        if (
            self.project.get("version") != 35
            or project_id != self.targetProjectId
            or not isinstance(scenes, list)
            or len(scenes) != 1
            or not isinstance(settings, dict)
            or not isinstance(canvas, dict)
            or not isinstance(canvas.get("width"), int)
            or canvas["width"] <= 0
            or not isinstance(canvas.get("height"), int)
            or canvas["height"] <= 0
            or self.provenance.sourceClipProjectId != self.clipProjectId
            or self.provenance.sourceClipProjectRevision
            != self.clipProjectRevision
        ):
            raise ValueError("handoff project provenance is invalid")
        attachment_ids = [item.mediaId for item in self.mediaAttachments]
        if len(attachment_ids) != len(set(attachment_ids)):
            raise ValueError("handoff media IDs are duplicated")
        referenced = collect_project_media_ids(self.project)
        if not referenced or referenced != set(attachment_ids):
            raise ValueError("handoff media coverage is invalid")
        if self.warnings != sorted(set(self.warnings)):
            raise ValueError("handoff warnings are not deterministic")
        try:
            ensure_portable_json(self.model_dump(mode="json"))
        except PersistenceError as exc:
            raise ValueError("handoff contains non-portable data") from exc
        return self

    def bounded_json(self, maximum_bytes: int) -> dict[str, Any]:
        value = self.model_dump(mode="json")
        if len(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            )
        ) > maximum_bytes:
            raise ValueError("handoff manifest exceeds its size limit")
        return value


def collect_project_media_ids(project: dict[str, Any]) -> set[str]:
    media_ids: set[str] = set()
    for scene in project.get("scenes") or []:
        tracks = scene.get("tracks") or {}
        candidates = []
        main = tracks.get("main")
        if isinstance(main, dict):
            candidates.append(main)
        for key in ("overlay", "audio"):
            value = tracks.get(key)
            if isinstance(value, list):
                candidates.extend(item for item in value if isinstance(item, dict))
        for track in candidates:
            for element in track.get("elements") or []:
                if (
                    isinstance(element, dict)
                    and element.get("type") in {"video", "audio", "image"}
                    and isinstance(element.get("mediaId"), str)
                ):
                    media_ids.add(element["mediaId"])
    return media_ids
