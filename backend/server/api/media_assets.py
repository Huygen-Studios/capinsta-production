import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiofiles
import aiosqlite
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..auth import current_user
from ..database import get_db
from ..settings import MAX_UPLOAD_SIZE_MB, MEDIA_DIR
from ..storage_paths import path_inside, safe_identifier
from ..storage_pressure import require_disk_capacity

router = APIRouter(prefix="/media/assets", tags=["media-assets"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _asset_path(project_id: str, asset_id: str) -> Path:
    safe_identifier(project_id, label="project id")
    safe_identifier(asset_id, label="asset id")
    return path_inside(MEDIA_DIR, project_id, asset_id)


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


@router.post("")
@router.post("/")
async def upload_media_asset(
    project_id: str = Form(...),
    file: UploadFile = File(...),
    db: aiosqlite.Connection = Depends(get_db),
):
    try:
        safe_identifier(project_id, label="project id")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    asset_id = str(uuid.uuid4())
    destination = _asset_path(project_id, asset_id)
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
                storage_path, status, created_at, last_accessed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
            """,
            (
                asset_id,
                project_id,
                current_user().id,
                Path(file.filename or "media").name,
                file.content_type,
                written,
                str(destination),
                now,
                now,
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
    path = Path(row["storage_path"])
    try:
        path.resolve().relative_to(MEDIA_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="Invalid media storage path.") from exc
    if not path.is_file():
        raise HTTPException(status_code=410, detail="Media asset has expired.")
    await db.execute(
        "UPDATE media_assets SET last_accessed_at = ? WHERE id = ?",
        (_now(), asset_id),
    )
    await db.commit()
    return FileResponse(
        path,
        media_type=row["mime_type"] or "application/octet-stream",
        filename=None,
    )


@router.head("/{asset_id}/content")
async def head_media_asset(asset_id: str, db: aiosqlite.Connection = Depends(get_db)):
    row = await get_owned_media_asset(db, asset_id)
    path = Path(row["storage_path"])
    try:
        path.resolve().relative_to(MEDIA_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="Invalid media storage path.") from exc
    if not path.is_file():
        raise HTTPException(status_code=410, detail="Media asset has expired.")
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
    path = Path(row["storage_path"])
    try:
        path.resolve().relative_to(MEDIA_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="Invalid media storage path.") from exc
    path.unlink(missing_ok=True)
    if path.parent != MEDIA_DIR and path.parent.exists():
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
