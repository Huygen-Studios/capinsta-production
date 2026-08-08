from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from fastapi import HTTPException, UploadFile

UploadKind = Literal["video", "audio", "image"]


@dataclass(frozen=True)
class UploadPolicyMatch:
    original_name: str
    suffix: str
    expected_kind: UploadKind
    safe_mime_type: str


VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg"}
SAFE_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
SUPPORTED_ASSET_EXTENSIONS = VIDEO_EXTENSIONS | AUDIO_EXTENSIONS | SAFE_IMAGE_EXTENSIONS

VIDEO_MIME_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/x-m4v",
    "video/webm",
    "application/octet-stream",
}
AUDIO_MIME_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/aac",
    "audio/mp4",
    "audio/ogg",
    "application/octet-stream",
}
IMAGE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "application/octet-stream",
}

DANGEROUS_EXTENSIONS = {
    ".7z",
    ".apk",
    ".asp",
    ".aspx",
    ".bat",
    ".cgi",
    ".cmd",
    ".com",
    ".dll",
    ".dmg",
    ".doc",
    ".docx",
    ".exe",
    ".gz",
    ".htm",
    ".html",
    ".jar",
    ".js",
    ".json",
    ".jsp",
    ".msi",
    ".pdf",
    ".php",
    ".ps1",
    ".py",
    ".rar",
    ".sh",
    ".svg",
    ".tar",
    ".tgz",
    ".vbs",
    ".xml",
    ".zip",
}

INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
WINDOWS_RESERVED_FILENAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
}
MAX_SAFE_FILENAME_LEN = 120


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def expected_kind_for_suffix(suffix: str) -> UploadKind | None:
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    if suffix in AUDIO_EXTENSIONS:
        return "audio"
    if suffix in SAFE_IMAGE_EXTENSIONS:
        return "image"
    return None


def content_type_allowed(kind: UploadKind, content_type: str | None) -> bool:
    if not content_type:
        return True
    normalized = content_type.split(";", 1)[0].strip().lower()
    if kind == "video":
        return normalized in VIDEO_MIME_TYPES
    if kind == "audio":
        return normalized in AUDIO_MIME_TYPES
    return normalized in IMAGE_MIME_TYPES


def sanitize_upload_filename(filename: str, ext: str) -> str:
    stem = Path(filename).stem
    stem = INVALID_FILENAME_CHARS.sub("_", stem)
    stem = re.sub(r"\s+", " ", stem).strip(" ._")
    if not stem:
        stem = "upload"
    if stem.upper() in WINDOWS_RESERVED_FILENAMES:
        stem = f"{stem}_file"
    max_stem_len = max(1, MAX_SAFE_FILENAME_LEN - len(ext))
    stem = stem[:max_stem_len].rstrip(" ._") or "upload"
    return f"{stem}{ext}"


def validate_upload_metadata(
    file: UploadFile,
    *,
    require_kind: UploadKind | None = None,
) -> UploadPolicyMatch:
    original_name = Path(file.filename or "media").name
    if not original_name or original_name in {".", ".."}:
        raise _error(400, "UPLOAD_FILENAME_INVALID", "Upload filename is invalid.")
    if INVALID_FILENAME_CHARS.search(file.filename or ""):
        raise _error(400, "UPLOAD_FILENAME_INVALID", "Upload filename contains unsafe characters.")

    suffixes = [suffix.lower() for suffix in Path(original_name).suffixes]
    suffix = suffixes[-1] if suffixes else ""
    if not suffix:
        raise _error(415, "UPLOAD_TYPE_NOT_ALLOWED", "This file type is not supported.")
    if suffix not in SUPPORTED_ASSET_EXTENSIONS:
        raise _error(415, "UPLOAD_TYPE_NOT_ALLOWED", "This file type is not supported.")
    if any(previous in DANGEROUS_EXTENSIONS for previous in suffixes[:-1]):
        raise _error(415, "UPLOAD_SUSPICIOUS_FILENAME", "This filename is not allowed.")
    if len(suffixes) > 1 and suffixes[-2] in SUPPORTED_ASSET_EXTENSIONS:
        raise _error(415, "UPLOAD_SUSPICIOUS_FILENAME", "This filename is not allowed.")

    kind = expected_kind_for_suffix(suffix)
    if kind is None or (require_kind is not None and kind != require_kind):
        raise _error(
            415,
            "UPLOAD_TYPE_NOT_ALLOWED",
            "Upload a supported video file." if require_kind == "video" else "This file type is not supported.",
        )
    if not content_type_allowed(kind, file.content_type):
        raise _error(415, "UPLOAD_MIME_MISMATCH", "The uploaded file type does not match its declared content type.")

    return UploadPolicyMatch(
        original_name=sanitize_upload_filename(original_name, suffix),
        suffix=suffix,
        expected_kind=kind,
        safe_mime_type=(file.content_type or "application/octet-stream").split(";", 1)[0].strip().lower(),
    )


def sniff_magic_kind(header: bytes) -> UploadKind | None:
    if header.startswith(b"\x89PNG\r\n\x1a\n") or header.startswith(b"\xff\xd8\xff"):
        return "image"
    if header.startswith(b"GIF87a") or header.startswith(b"GIF89a"):
        return "image"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image"
    if header.startswith(b"RIFF") and header[8:12] == b"WAVE":
        return "audio"
    if header.startswith(b"ID3") or header[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}:
        return "audio"
    if header.startswith(b"OggS"):
        return "audio"
    if b"ftyp" in header[:16]:
        return "video"
    if header.startswith(b"\x1a\x45\xdf\xa3"):
        return "video"
    return None
