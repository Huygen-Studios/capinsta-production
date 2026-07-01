import os
import json
import shutil
import asyncio
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path

import aiofiles
import aiosqlite
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..auth import current_user
from ..database import get_db
from ..settings import MAX_UPLOAD_SIZE_MB, MEDIA_DIR
from ..storage_paths import path_inside, public_download_name, resolve_existing_file_inside, safe_identifier
from ..storage_pressure import require_disk_capacity
from ..upload_security import (
    AUDIO_EXTENSIONS,
    SAFE_IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    sniff_magic_kind,
    validate_upload_metadata,
)

router = APIRouter(prefix="/media/assets", tags=["media-assets"])
logger = logging.getLogger(__name__)

_ALLOWED_MEDIA_EXTENSIONS = VIDEO_EXTENSIONS | AUDIO_EXTENSIONS | SAFE_IMAGE_EXTENSIONS
_VIDEO_EXTENSIONS = VIDEO_EXTENSIONS
_MAX_MEDIA_DURATION_SECONDS = int(os.getenv("MAX_MEDIA_DURATION_SECONDS", "600"))
_MAX_MEDIA_LONG_EDGE = int(os.getenv("MAX_MEDIA_LONG_EDGE", "4096"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _asset_path(user_id: str, project_id: str, asset_id: str) -> Path:
    safe_identifier(user_id, label="user id")
    safe_identifier(project_id, label="project id")
    safe_identifier(asset_id, label="asset id")
    return path_inside(MEDIA_DIR, user_id, project_id, asset_id)


def _row_keys(row: aiosqlite.Row) -> set[str]:
    try:
        return set(row.keys())
    except AttributeError:
        return set()


def _media_asset_row_incomplete(missing_fields: list[str]) -> HTTPException:
    diagnostic_id = str(uuid.uuid4())
    logger.error(
        "media_asset_row_incomplete diagnostic_id=%s missing_fields=%s",
        diagnostic_id,
        missing_fields,
    )
    return HTTPException(
        status_code=500,
        detail={
            "code": "media_asset_row_incomplete",
            "message": "The source media metadata is incomplete. Please retry after refreshing the project.",
            "diagnosticId": diagnostic_id,
            "missingFields": missing_fields,
        },
    )


def validate_media_asset_row(row: aiosqlite.Row) -> None:
    required_fields = ("id", "user_id", "project_id", "storage_path")
    keys = _row_keys(row)
    missing = [field for field in required_fields if field not in keys]
    if missing:
        raise _media_asset_row_incomplete(missing)
    empty = [field for field in ("id", "user_id", "project_id") if not str(row[field] or "").strip()]
    if empty:
        raise _media_asset_row_incomplete(empty)


def expected_media_asset_path(row: aiosqlite.Row) -> Path:
    validate_media_asset_row(row)
    return _asset_path(str(row["user_id"]), str(row["project_id"]), str(row["id"]))


def _sniff_media_kind(path: Path) -> str | None:
    return sniff_magic_kind(path.read_bytes()[:64])


def _image_dimensions(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()[:4096]
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if (data.startswith(b"GIF87a") or data.startswith(b"GIF89a")) and len(data) >= 10:
        return int.from_bytes(data[6:8], "little"), int.from_bytes(data[8:10], "little")
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        if data[12:16] == b"VP8X" and len(data) >= 30:
            width = 1 + int.from_bytes(data[24:27], "little")
            height = 1 + int.from_bytes(data[27:30], "little")
            return width, height
        if data[12:16] == b"VP8 " and len(data) >= 30:
            return int.from_bytes(data[26:28], "little") & 0x3FFF, int.from_bytes(data[28:30], "little") & 0x3FFF
    if data.startswith(b"\xff\xd8"):
        index = 2
        while index + 9 < len(data):
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                return int.from_bytes(data[index + 7:index + 9], "big"), int.from_bytes(data[index + 5:index + 7], "big")
            block_length = int.from_bytes(data[index + 2:index + 4], "big")
            if block_length < 2:
                return None
            index += 2 + block_length
    return None


def _stream_metadata(stream: dict) -> dict[str, object]:
    metadata: dict[str, object] = {
        "codecType": stream.get("codec_type"),
        "codecName": stream.get("codec_name"),
    }
    for key in ("width", "height"):
        value = stream.get(key)
        if value is not None:
            try:
                metadata[key] = int(value)
            except (TypeError, ValueError):
                pass
    return {key: value for key, value in metadata.items() if value is not None}


def _safe_probe_metadata(
    *,
    kind: str,
    suffix: str,
    mime_type: str | None = None,
    duration: float | None = None,
    dimensions: tuple[int, int] | None = None,
    ffprobe_payload: dict | None = None,
) -> dict[str, object]:
    metadata: dict[str, object] = {
        "status": "validated",
        "kind": kind,
        "suffix": suffix,
        "mimeType": mime_type,
        "validatedAt": _now(),
    }
    if duration is not None:
        metadata["durationSeconds"] = duration
    if dimensions is not None:
        metadata["dimensions"] = {"width": dimensions[0], "height": dimensions[1]}
    if ffprobe_payload:
        format_payload = ffprobe_payload.get("format") or {}
        format_name = format_payload.get("format_name")
        if format_name:
            metadata["container"] = format_name
        streams = [
            _stream_metadata(stream)
            for stream in ffprobe_payload.get("streams", [])
            if isinstance(stream, dict)
        ]
        metadata["streams"] = streams[:8]
        video_streams = [stream for stream in streams if stream.get("codecType") == "video"]
        audio_streams = [stream for stream in streams if stream.get("codecType") == "audio"]
        if video_streams:
            metadata["video"] = video_streams[0]
        if audio_streams:
            metadata["audio"] = audio_streams[0]
    return {key: value for key, value in metadata.items() if value is not None}


async def validate_media_file_contents(
    path: Path,
    *,
    original_name: str,
    require_video: bool = False,
    mime_type: str | None = None,
) -> dict[str, object]:
    suffix = Path(original_name).suffix.lower()
    kind = _sniff_media_kind(path)
    if kind is None or (require_video and kind != "video"):
        raise HTTPException(
            status_code=415,
            detail={
                "code": "unsupported_media_type",
                "message": "Upload a supported video file." if require_video else "Upload a supported video, audio, or image file.",
            },
        )
    if kind == "image":
        dimensions = _image_dimensions(path)
        if dimensions is None:
            raise HTTPException(status_code=415, detail="Image file could not be decoded.")
        if max(dimensions) > _MAX_MEDIA_LONG_EDGE:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "media_dimensions_limit",
                    "message": f"Media dimensions must be at most {_MAX_MEDIA_LONG_EDGE}px on the longest edge.",
                },
            )
        image_metadata = _safe_probe_metadata(
            kind=kind,
            suffix=suffix,
            mime_type=mime_type,
            dimensions=dimensions,
        )
    expected_suffix_kind = (
        "video"
        if suffix in VIDEO_EXTENSIONS
        else "audio"
        if suffix in AUDIO_EXTENSIONS
        else "image"
        if suffix in SAFE_IMAGE_EXTENSIONS
        else None
    )
    if expected_suffix_kind != kind:
        raise HTTPException(
            status_code=415,
            detail={
                "code": "upload_magic_mismatch",
                "message": "The uploaded file content does not match its filename.",
            },
        )
    if suffix in _VIDEO_EXTENSIONS or kind in {"video", "audio"}:
        if not shutil.which("ffprobe"):
            raise HTTPException(status_code=503, detail="Media validation is temporarily unavailable.")
        process = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,format_name:stream=codec_type,codec_name,width,height",
            "-of",
            "json",
            str(path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=20)
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise HTTPException(status_code=415, detail="Media file validation timed out.") from exc
        if process.returncode != 0:
            raise HTTPException(status_code=415, detail="Media file could not be decoded.")
        try:
            payload = json.loads(stdout.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=415, detail="Media file metadata could not be parsed.") from exc
        try:
            duration = float((payload.get("format") or {}).get("duration") or 0)
        except (TypeError, ValueError):
            duration = 0
        if duration <= 0 or duration > _MAX_MEDIA_DURATION_SECONDS:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "media_duration_limit",
                    "message": f"Media duration must be between 0 and {_MAX_MEDIA_DURATION_SECONDS} seconds.",
                },
            )
        video_streams = [
            stream for stream in payload.get("streams", [])
            if isinstance(stream, dict) and stream.get("codec_type") == "video"
        ]
        audio_streams = [
            stream for stream in payload.get("streams", [])
            if isinstance(stream, dict) and stream.get("codec_type") == "audio"
        ]
        if len(video_streams) + len(audio_streams) > 8:
            raise HTTPException(
                status_code=415,
                detail={
                    "code": "media_stream_limit",
                    "message": "Media file contains too many streams.",
                },
            )
        if require_video and not video_streams:
            raise HTTPException(status_code=415, detail="Upload a supported video file.")
        for stream in video_streams:
            width = int(stream.get("width") or 0)
            height = int(stream.get("height") or 0)
            if max(width, height) > _MAX_MEDIA_LONG_EDGE:
                raise HTTPException(
                    status_code=413,
                    detail={
                        "code": "media_dimensions_limit",
                        "message": f"Media dimensions must be at most {_MAX_MEDIA_LONG_EDGE}px on the longest edge.",
                    },
                )
        return _safe_probe_metadata(
            kind=kind,
            suffix=suffix,
            mime_type=mime_type,
            duration=duration,
            ffprobe_payload=payload,
        )
    return image_metadata


def _validate_media_upload(file: UploadFile) -> str:
    return validate_upload_metadata(file).original_name


async def get_owned_media_asset(
    db: aiosqlite.Connection, asset_id: str
) -> aiosqlite.Row:
    cursor = await db.execute(
        """
        SELECT * FROM media_assets
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        """,
        (asset_id, current_user().id),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Media asset was not found.")
    return row


def resolve_owned_media_asset_file(row: aiosqlite.Row) -> Path:
    validate_media_asset_row(row)
    expected = expected_media_asset_path(row).resolve()
    try:
        actual = resolve_existing_file_inside(MEDIA_DIR, row["storage_path"], label="media asset")
    except FileNotFoundError:
        raise HTTPException(status_code=410, detail="Media asset has expired.")
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="Invalid media storage path.") from exc
    if actual != expected:
        raise HTTPException(
            status_code=410,
            detail={
                "code": "media_asset_requires_migration",
                "message": "Media asset must be migrated before it can be served.",
            },
        )
    return actual


@router.post("")
@router.post("/")
async def upload_media_asset(
    project_id: str = Form(...),
    file: UploadFile = File(...),
    db: aiosqlite.Connection = Depends(get_db),
):
    original_name = _validate_media_upload(file)
    try:
        safe_identifier(project_id, label="project id")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    asset_id = str(uuid.uuid4())
    destination = _asset_path(current_user().id, project_id, asset_id)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{asset_id}.uploading")
    max_bytes = MAX_UPLOAD_SIZE_MB * 1024 * 1024
    declared_size = int(file.size or 0)
    require_disk_capacity(operation="upload", required_bytes=declared_size)
    written = 0
    try:
        async with aiofiles.open(temporary, "wb") as output:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail={
                            "code": "upload_too_large",
                            "maxBytes": max_bytes,
                        },
                    )
                require_disk_capacity(
                    operation="upload",
                    required_bytes=max(0, declared_size - written),
                )
                await output.write(chunk)
        validation_metadata = await validate_media_file_contents(
            temporary,
            original_name=original_name,
            require_video=False,
            mime_type=file.content_type,
        )
        os.replace(temporary, destination)
    except HTTPException:
        temporary.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        if destination.parent.exists() and not any(destination.parent.iterdir()):
            destination.parent.rmdir()
        raise
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        if destination.parent.exists() and not any(destination.parent.iterdir()):
            destination.parent.rmdir()
        raise HTTPException(
            status_code=500,
            detail={
                "code": "media_upload_failed",
                "message": "Upload could not be saved. Please retry.",
            },
        ) from exc
    finally:
        await file.close()

    now = _now()
    try:
        await db.execute(
            """
            INSERT INTO media_assets (
                id, project_id, user_id, original_name, mime_type, size_bytes,
                storage_path, status, created_at, last_accessed_at,
                validation_status, validation_metadata_json, validation_checked_at,
                media_duration_seconds
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?)
            """,
            (
                asset_id,
                project_id,
                current_user().id,
                original_name,
                file.content_type,
                written,
                str(destination),
                now,
                now,
                "validated",
                json.dumps(validation_metadata, ensure_ascii=False),
                validation_metadata.get("validatedAt") or now,
                validation_metadata.get("durationSeconds"),
            ),
        )
        await db.commit()
    except Exception:
        destination.unlink(missing_ok=True)
        temporary.unlink(missing_ok=True)
        try:
            destination.parent.rmdir()
        except OSError:
            pass
        raise
    return {
        "assetId": asset_id,
        "projectId": project_id,
        "sizeBytes": written,
        "mimeType": file.content_type,
        "downloadUrl": f"/api/media/assets/{asset_id}/content",
    }


@router.get("/{asset_id}/content")
async def download_media_asset(
    asset_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    row = await get_owned_media_asset(db, asset_id)
    path = resolve_owned_media_asset_file(row)
    await db.execute(
        "UPDATE media_assets SET last_accessed_at = ? WHERE id = ?",
        (_now(), asset_id),
    )
    await db.commit()
    return FileResponse(
        path,
        media_type=row["mime_type"] or "application/octet-stream",
        filename=public_download_name(row["original_name"], fallback="media"),
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.head("/{asset_id}/content")
async def head_media_asset(asset_id: str, db: aiosqlite.Connection = Depends(get_db)):
    row = await get_owned_media_asset(db, asset_id)
    path = resolve_owned_media_asset_file(row)
    await db.execute(
        "UPDATE media_assets SET last_accessed_at = ? WHERE id = ?",
        (_now(), asset_id),
    )
    await db.commit()
    return None


@router.delete("/{asset_id}", status_code=204)
async def delete_media_asset(
    asset_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    row = await get_owned_media_asset(db, asset_id)
    path: Path | None
    try:
        path = resolve_owned_media_asset_file(row)
    except HTTPException as exc:
        if exc.status_code != 410:
            raise
        path = None
    if path:
        path.unlink(missing_ok=True)
    if path and path.parent != MEDIA_DIR and path.parent.exists():
        try:
            path.parent.rmdir()
        except OSError:
            pass
    await db.execute(
        "UPDATE media_assets SET status = 'deleted', deleted_at = ? WHERE id = ?",
        (_now(), asset_id),
    )
    await db.commit()
    return None
