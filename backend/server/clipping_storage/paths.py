from __future__ import annotations

import re
from pathlib import PurePosixPath
from uuid import UUID

from .errors import StorageError

MIME_EXTENSIONS = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
}
ALLOWED_SOURCE_MIME_TYPES = frozenset(MIME_EXTENSIONS)
_SAFE_PATH = re.compile(
    r"^[0-9a-f-]{36}/[0-9a-f-]{36}/source/v[1-9][0-9]*\.[a-z0-9]{2,5}$"
)
_SAFE_VARIANT_PATH = re.compile(
    r"^[0-9a-f-]{36}/[0-9a-f-]{36}/variants/"
    r"(proxy|audio_extract|thumbnail|waveform)/r[1-9][0-9]*/"
    r"[0-9a-f]{12}/(proxy\.mp4|audio\.wav|poster\.jpg|waveform\.json)$"
)
_SAFE_EXPORT_PATH = re.compile(
    r"^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,200}/exports/"
    r"r[1-9][0-9]*/[0-9a-f]{16}/[0-9a-f-]{36}\.mp4$"
)


def extension_for_mime(mime_type: str) -> str:
    normalized = mime_type.split(";", 1)[0].strip().lower()
    try:
        return MIME_EXTENSIONS[normalized]
    except KeyError as exc:
        raise StorageError(
            "upload_mime_mismatch",
            "The source media MIME type is not supported",
            {"mimeType": normalized},
        ) from exc


def validate_object_path(path: str) -> str:
    if (
        not path
        or "\x00" in path
        or "\\" in path
        or path.startswith("/")
        or ".." in PurePosixPath(path).parts
        or not (
            _SAFE_PATH.fullmatch(path)
            or _SAFE_VARIANT_PATH.fullmatch(path)
            or _SAFE_EXPORT_PATH.fullmatch(path)
        )
    ):
        raise StorageError(
            "object_path_invalid",
            "Storage object path is not a valid durable media path",
        )
    return path


def validate_export_object_path(path: str) -> str:
    validate_object_path(path)
    if not _SAFE_EXPORT_PATH.fullmatch(path):
        raise StorageError(
            "bucket_not_allowed",
            "The object path does not belong to the clipping export bucket",
        )
    return path


def source_object_path(
    *,
    owner_user_id: UUID,
    media_asset_id: UUID,
    mime_type: str,
    version: int = 1,
) -> str:
    if version < 1:
        raise StorageError(
            "object_path_invalid", "Storage object version must be positive"
        )
    path = (
        f"{owner_user_id}/{media_asset_id}/source/"
        f"v{version}{extension_for_mime(mime_type)}"
    )
    return validate_object_path(path)


def validate_display_filename(filename: str) -> str:
    if (
        not filename
        or len(filename) > 120
        or "\x00" in filename
        or "/" in filename
        or "\\" in filename
        or filename in {".", ".."}
    ):
        raise StorageError(
            "object_path_invalid", "The original media filename is invalid"
        )
    return filename
