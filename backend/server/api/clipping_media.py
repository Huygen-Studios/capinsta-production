from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from ..auth import current_user
from ..clipping_persistence.database import DurableDatabase
from ..clipping_persistence.models import AuthenticatedActor
from ..clipping_storage.config import MediaStorageConfig
from ..clipping_storage.errors import StorageError
from ..clipping_storage.local_storage import LocalMediaStorage
from ..clipping_storage.repository import MediaStorageRepository
from ..clipping_storage.services import (
    MediaAccessService,
    MediaDeletionService,
    MediaUploadService,
)
from ..clipping_storage.supabase_storage import SupabaseMediaStorage

router = APIRouter(prefix="/clipping/media", tags=["clipping-media"])


class UploadCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    displayName: str = Field(min_length=1, max_length=120)
    mimeType: str = Field(min_length=1, max_length=100)
    sizeBytes: int = Field(gt=0)
    replaceMediaAssetId: UUID | None = None
    expectedRevision: int | None = Field(default=None, ge=1)


class UploadCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    createProbeJob: bool = True


def _actor() -> AuthenticatedActor:
    return AuthenticatedActor.from_verified_user(current_user().id)


def _services():
    config = MediaStorageConfig.from_env()
    if not config.enabled:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "storage_not_configured",
                "message": "Durable media storage is not enabled",
            },
        )
    repository = MediaStorageRepository(DurableDatabase())
    storage = (
        LocalMediaStorage(Path(config.local_storage_root))
        if config.local_storage_root
        else SupabaseMediaStorage(config)
    )
    return (
        MediaUploadService(
            config=config, storage=storage, repository=repository
        ),
        MediaAccessService(
            config=config, storage=storage, repository=repository
        ),
        MediaDeletionService(storage=storage, repository=repository),
    )


def _raise_storage(error: StorageError) -> None:
    status = {
        "storage_permission_denied": 403,
        "object_not_found": 404,
        "upload_session_not_found": 404,
        "media_asset_deleted": 410,
        "upload_session_expired": 410,
        "object_already_exists": 409,
        "active_upload_limit_exceeded": 429,
        "upload_session_completed": 409,
        "idempotency_conflict": 409,
        "idempotency_in_progress": 409,
        "stale_revision": 409,
        "upload_size_mismatch": 413,
        "upload_mime_mismatch": 415,
        "storage_not_configured": 503,
        "storage_provider_unavailable": 503,
        "storage_delete_failed": 503,
        "signed_url_failed": 502,
    }.get(error.category, 422)
    raise HTTPException(status_code=status, detail=error.as_dict()) from error


@router.post("/uploads", status_code=201)
async def create_upload(
    payload: UploadCreateRequest,
    request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    try:
        upload, _, _ = _services()
        instructions = await upload.create_upload_session(
            _actor(),
            display_name=payload.displayName,
            mime_type=payload.mimeType,
            size_bytes=payload.sizeBytes,
            idempotency_key=idempotency_key,
            replace_media_asset_id=payload.replaceMediaAssetId,
            expected_revision=payload.expectedRevision,
        )
        result = instructions.as_dict()
        if isinstance(upload.storage, LocalMediaStorage):
            result["uploadUrl"] = str(request.base_url).rstrip("/") + (
                f"/api/clipping/media/uploads/{instructions.upload_session_id}/tus"
            )
        return result
    except StorageError as error:
        _raise_storage(error)


@router.get("/uploads/{upload_session_id}")
async def get_upload_status(upload_session_id: UUID):
    try:
        upload, _, _ = _services()
        return await upload.get_upload_status(_actor(), upload_session_id)
    except StorageError as error:
        _raise_storage(error)


@router.post("/uploads/{upload_session_id}/complete")
async def complete_upload(
    upload_session_id: UUID,
    request: UploadCompleteRequest | None = None,
):
    try:
        upload, _, _ = _services()
        attachment = await upload.complete_media_upload(
            _actor(),
            upload_session_id,
            create_probe_job=(
                request.createProbeJob if request is not None else True
            ),
        )
        return attachment.as_dict()
    except StorageError as error:
        _raise_storage(error)


async def _local_upload(
    upload_session_id: UUID,
) -> tuple[MediaUploadService, LocalMediaStorage, dict]:
    upload, _, _ = _services()
    if not isinstance(upload.storage, LocalMediaStorage):
        raise HTTPException(status_code=404, detail={"code": "local_upload_disabled"})
    session = await upload.repository.get_session(_actor(), upload_session_id)
    return upload, upload.storage, session


@router.post("/uploads/{upload_session_id}/tus", status_code=201)
async def local_tus_create(upload_session_id: UUID, request: Request):
    try:
        _, storage, session = await _local_upload(upload_session_id)
        location = str(request.url)
        return Response(
            status_code=201,
            headers={
                "Location": location,
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": "0",
            },
        )
    except StorageError as error:
        _raise_storage(error)


@router.head("/uploads/{upload_session_id}/tus")
async def local_tus_status(upload_session_id: UUID):
    try:
        _, storage, session = await _local_upload(upload_session_id)
        target = storage._path(session["storage_bucket"], session["storage_path"])
        offset = target.stat().st_size if target.exists() else 0
        return Response(headers={"Tus-Resumable": "1.0.0", "Upload-Offset": str(offset)})
    except StorageError as error:
        _raise_storage(error)


@router.patch("/uploads/{upload_session_id}/tus", status_code=204)
async def local_tus_patch(
    upload_session_id: UUID,
    request: Request,
    upload_offset: int = Header(alias="Upload-Offset", ge=0),
):
    try:
        upload, storage, session = await _local_upload(upload_session_id)
        content = await request.body()
        if upload_offset + len(content) > session["expected_size_bytes"]:
            raise StorageError("upload_size_mismatch", "Upload exceeds its declared size")
        next_offset = await storage.write_upload_chunk(
            bucket=session["storage_bucket"],
            path=session["storage_path"],
            offset=upload_offset,
            content=content,
        )
        return Response(
            status_code=204,
            headers={"Tus-Resumable": "1.0.0", "Upload-Offset": str(next_offset)},
        )
    except StorageError as error:
        _raise_storage(error)


@router.get("/{media_asset_id}/local-content")
async def local_content(media_asset_id: UUID, download: bool = False):
    try:
        upload, _, _ = _services()
        if not isinstance(upload.storage, LocalMediaStorage):
            raise HTTPException(status_code=404, detail={"code": "local_storage_disabled"})
        asset = await upload.repository.get_asset(_actor(), media_asset_id)
        target = upload.storage._path(asset["storage_bucket"], asset["storage_path"])
        return FileResponse(
            target,
            media_type=asset["mime_type"],
            filename=asset["display_name"] if download else None,
        )
    except StorageError as error:
        _raise_storage(error)


@router.get("/{media_asset_id}/preview-url")
async def preview_url(
    media_asset_id: UUID,
    request: Request,
    expires_in: int | None = Query(default=None, alias="expiresIn", ge=1),
):
    try:
        upload, access, _ = _services()
        if isinstance(upload.storage, LocalMediaStorage):
            return {
                "mediaAssetId": str(media_asset_id),
                "url": str(request.base_url).rstrip("/") + f"/api/clipping/media/{media_asset_id}/local-content",
                "expiresAt": "9999-12-31T23:59:59+00:00",
                "disposition": "inline",
            }
        result = await access.create_media_preview_url(
            _actor(), media_asset_id, expires_in=expires_in
        )
        return result.as_dict()
    except StorageError as error:
        _raise_storage(error)


@router.get("/{media_asset_id}/download-url")
async def download_url(
    media_asset_id: UUID,
    request: Request,
    expires_in: int | None = Query(default=None, alias="expiresIn", ge=1),
):
    try:
        upload, access, _ = _services()
        if isinstance(upload.storage, LocalMediaStorage):
            return {
                "mediaAssetId": str(media_asset_id),
                "url": str(request.base_url).rstrip("/") + f"/api/clipping/media/{media_asset_id}/local-content?download=true",
                "expiresAt": "9999-12-31T23:59:59+00:00",
                "disposition": "attachment",
            }
        result = await access.create_media_download_url(
            _actor(), media_asset_id, expires_in=expires_in
        )
        return result.as_dict()
    except StorageError as error:
        _raise_storage(error)


@router.delete("/{media_asset_id}")
async def delete_media(media_asset_id: UUID):
    try:
        _, _, deletion = _services()
        return await deletion.delete_media(_actor(), media_asset_id)
    except StorageError as error:
        _raise_storage(error)
