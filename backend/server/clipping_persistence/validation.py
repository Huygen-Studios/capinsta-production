from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from contracts.clip_project_v1 import ClipProjectV1
from contracts.edit_decision_list_v1 import EditDecisionListV1
from contracts.remapped_transcript_v1 import RemappedTranscriptV1
from contracts.transcript_document_v2 import TranscriptDocumentV2

from .errors import PersistenceError

_ABSOLUTE_WINDOWS = re.compile(r"^[A-Za-z]:[\\/]")
_ABSOLUTE_UNIX = re.compile(r"^/(?:tmp|var/tmp|home|Users|mnt|private|opt)/")
_SIGNED_URL_VALUE = re.compile(
    r"(?:/storage/v1/object/sign/|[?&](?:token|signature|sig|x-amz-signature|apikey)=)",
    re.IGNORECASE,
)
_PRIVATE_PATH_KEYS = frozenset(
    {"absolutePath", "localPath", "filesystemPath", "filePath"}
)
_PRIVATE_CREDENTIAL_KEYS = frozenset(
    {
        "signedurl",
        "downloadurl",
        "storagepath",
        "accessurl",
        "accesstoken",
        "refreshtoken",
        "servicerolekey",
        "authorization",
        "authorizationheaders",
    }
)


def _invalid_contract(entity_type: str, exc: Exception) -> PersistenceError:
    details: dict[str, Any] = {"entityType": entity_type}
    if isinstance(exc, ValidationError) and exc.errors():
        details["fieldPath"] = ".".join(str(x) for x in exc.errors()[0]["loc"])
    return PersistenceError(
        "invalid_contract",
        f"Invalid {entity_type} contract",
        details,
    )


def ensure_portable_json(value: Any, path: str = "metadata") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            item_path = f"{path}.{key}"
            if key in _PRIVATE_PATH_KEYS and isinstance(item, str) and item:
                raise PersistenceError(
                    "invalid_contract",
                    "Portable records cannot contain private filesystem paths",
                    {"fieldPath": item_path},
                )
            normalized_key = re.sub(r"[^a-z0-9]", "", key.lower())
            if normalized_key in _PRIVATE_CREDENTIAL_KEYS and item not in (None, ""):
                raise PersistenceError(
                    "invalid_contract",
                    "Portable records cannot contain signed URLs or credentials",
                    {"fieldPath": item_path},
                )
            ensure_portable_json(item, item_path)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            ensure_portable_json(item, f"{path}.{index}")
    elif isinstance(value, str):
        lowered = value.strip().lower()
        if (
            lowered.startswith(("blob:", "file:"))
            or _SIGNED_URL_VALUE.search(value)
            or lowered.startswith("bearer ")
        ):
            raise PersistenceError(
                "invalid_contract",
                "Portable records cannot contain ephemeral access data",
                {"fieldPath": path},
            )
        if _ABSOLUTE_WINDOWS.match(value) or _ABSOLUTE_UNIX.match(value):
            raise PersistenceError(
                "invalid_contract",
                "Portable records cannot contain absolute filesystem paths",
                {"fieldPath": path},
            )


def validate_transcript(
    document: dict[str, Any], *, transcript_id: str, media_asset_id: UUID
) -> dict[str, Any]:
    try:
        model = TranscriptDocumentV2.model_validate(document)
    except ValidationError as exc:
        raise _invalid_contract("transcript", exc) from exc
    if model.transcriptId != transcript_id:
        raise PersistenceError(
            "invalid_contract",
            "Transcript row ID does not match transcriptId",
            {"fieldPath": "transcriptId", "entityId": transcript_id},
        )
    if model.mediaId != str(media_asset_id):
        raise PersistenceError(
            "invalid_contract",
            "Transcript media ID does not match media asset",
            {"fieldPath": "mediaId", "entityId": transcript_id},
        )
    ensure_portable_json(model.metadata)
    return model.model_dump(mode="json")


def validate_clip_project(
    project: dict[str, Any],
    *,
    project_id: str,
    media_asset_id: UUID,
    revision: int,
    transcript_id: str | None,
) -> dict[str, Any]:
    try:
        model = ClipProjectV1.model_validate(project)
    except ValidationError as exc:
        raise _invalid_contract("clip_project", exc) from exc
    checks = (
        (model.clipProjectId == project_id, "clipProjectId"),
        (model.sourceMedia.mediaId == str(media_asset_id), "sourceMedia.mediaId"),
        (model.revision == revision, "revision"),
        (model.transcriptId == transcript_id, "transcriptId"),
    )
    for valid, field_path in checks:
        if not valid:
            raise PersistenceError(
                "invalid_contract",
                "Clip project row and contract fields do not match",
                {"fieldPath": field_path, "entityId": project_id},
            )
    ensure_portable_json(model.metadata)
    ensure_portable_json(model.sourceMedia.metadata, "sourceMedia.metadata")
    return model.model_dump(mode="json")


def validate_derived_caches(
    *,
    project_id: str,
    revision: int,
    media_asset_id: UUID,
    transcript_id: str | None,
    edl: dict[str, Any] | None,
    remapped_transcript: dict[str, Any] | None,
    conversion_result: dict[str, Any] | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None]:
    try:
        edl_model = EditDecisionListV1.model_validate(edl) if edl is not None else None
        remapped_model = (
            RemappedTranscriptV1.model_validate(remapped_transcript)
            if remapped_transcript is not None
            else None
        )
    except ValidationError as exc:
        raise _invalid_contract("derived_cache", exc) from exc
    if edl_model is not None and (
        edl_model.clipProjectId != project_id
        or edl_model.projectRevision != revision
        or edl_model.sourceMediaId != str(media_asset_id)
    ):
        raise PersistenceError(
            "invalid_contract",
            "EDL cache provenance does not match the clip project",
            {"entityId": project_id},
        )
    if remapped_model is not None and (
        remapped_model.clipProjectId != project_id
        or remapped_model.projectRevision != revision
        or remapped_model.sourceMediaId != str(media_asset_id)
        or remapped_model.sourceTranscriptId != transcript_id
        or (
            edl_model is not None
            and remapped_model.outputDurationMs != edl_model.outputDurationMs
        )
    ):
        raise PersistenceError(
            "invalid_contract",
            "Remapped transcript cache provenance does not match",
            {"entityId": project_id},
        )
    if conversion_result is not None:
        if (
            conversion_result.get("schemaVersion") != 1
            or conversion_result.get("sourceClipProjectId") != project_id
            or conversion_result.get("sourceClipProjectRevision") != revision
            or (conversion_result.get("mapping") or {}).get("sourceMediaId")
            != str(media_asset_id)
            or not isinstance(conversion_result.get("project"), dict)
            or not isinstance(
                (conversion_result.get("project") or {}).get("version"), int
            )
        ):
            raise PersistenceError(
                "invalid_contract",
                "Conversion cache provenance does not match",
                {"entityId": project_id},
            )
        ensure_portable_json(conversion_result, "latestConversionResult")
    return (
        edl_model.model_dump(mode="json") if edl_model else None,
        remapped_model.model_dump(mode="json") if remapped_model else None,
        conversion_result,
    )
