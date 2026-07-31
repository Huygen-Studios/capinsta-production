from __future__ import annotations

import logging
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from ..auth import current_user
from ..clipping_persistence.database import DurableDatabase
from ..clipping_persistence.models import AuthenticatedActor
from ..clipping_storage.config import MediaStorageConfig
from ..clipping_storage.errors import StorageError
from ..clipping_storage.local_storage import LocalMediaStorage
from ..clipping_storage.provider import media_storage_from_config
from ..clipping_storage.repository import MediaStorageRepository
from ..clipping_storage.services import (
    MediaAccessService,
    MediaDeletionService,
    MediaUploadService,
)

router = APIRouter(prefix="/clipping/media", tags=["clipping-media"])
logger = logging.getLogger(__name__)


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
    parts: list[dict[str, int | str]] | None = None


class SignPartsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    partNumbers: list[int] = Field(min_length=1, max_length=20)


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
    storage = media_storage_from_config(config)
    return (
        MediaUploadService(
            config=config, storage=storage, repository=repository
        ),
        MediaAccessService(
            config=config, storage=storage, repository=repository
        ),
        MediaDeletionService(config=config, storage=storage, repository=repository),
    )


def _storage_status(error: StorageError) -> int:
    return {
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
        "storage_schema_outdated": 503,
        "storage_persistence_failed": 503,
        "r2_not_configured": 503,
        "r2_bucket_missing": 503,
        "r2_credentials_invalid": 503,
        "storage_provider_unavailable": 503,
        "storage_delete_failed": 503,
        "signed_url_failed": 502,
        "multipart_creation_failed": 503,
        "multipart_upload_expired": 410,
        "multipart_part_failed": 502,
        "multipart_etag_missing": 422,
        "multipart_part_mismatch": 422,
        "multipart_completion_failed": 502,
        "multipart_abort_failed": 502,
        "object_verification_failed": 502,
        "object_size_mismatch": 409,
        "signed_url_expired": 410,
    }.get(error.category, 422)


def _raise_storage(error: StorageError) -> None:
    raise HTTPException(status_code=_storage_status(error), detail=error.as_dict()) from error


def _request_id(request: Request) -> str:
    return (
        request.headers.get("x-request-id")
        or request.headers.get("x-correlation-id")
        or str(uuid4())
    )


def _upload_error_response(
    error: StorageError, *, request_id: str
) -> JSONResponse:
    return JSONResponse(
        status_code=_storage_status(error),
        content={
            "detail": {
                "code": error.category,
                "message": error.message,
                "stage": error.details.get("stage", "upload_authorization"),
                "requestId": request_id,
            }
        },
        headers={"X-Request-ID": request_id},
    )


@router.get("/upload-limits")
async def upload_limits():
    try:
        upload, _, _ = _services()
        return await upload.upload_limits()
    except StorageError as error:
        _raise_storage(error)


@router.post("/uploads", status_code=201)
async def create_upload(
    payload: UploadCreateRequest,
    request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    request_id = _request_id(request)
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
            request_id=request_id,
        )
        result = instructions.as_dict()
        if isinstance(upload.storage, LocalMediaStorage):
            result["uploadUrl"] = str(request.base_url).rstrip("/") + (
                f"/api/clipping/media/uploads/{instructions.upload_session_id}/tus"
            )
        return result
    except StorageError as error:
        logger.warning(
            "media_upload_create_failed request_id=%s stage=%s exception_type=%s category=%s",
            request_id,
            error.details.get("stage", "upload_authorization"),
            type(error).__name__,
            error.category,
        )
        return _upload_error_response(error, request_id=request_id)
    except Exception as error:
        logger.exception(
            "media_upload_create_failed request_id=%s stage=upload_intent_persistence exception_type=%s category=unexpected_error",
            request_id,
            type(error).__name__,
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": {
                    "code": "internal_error",
                    "message": "The upload session could not be created",
                    "stage": "upload_intent_persistence",
                    "requestId": request_id,
                }
            },
            headers={"X-Request-ID": request_id},
        )


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
            parts=request.parts if request is not None else None,
        )
        return attachment.as_dict()
    except StorageError as error:
        _raise_storage(error)


@router.post("/uploads/{upload_session_id}/parts/sign")
async def sign_upload_parts(upload_session_id: UUID, payload: SignPartsRequest):
    try:
        upload, _, _ = _services()
        return await upload.sign_multipart_parts(
            _actor(), upload_session_id, part_numbers=payload.partNumbers
        )
    except StorageError as error:
        _raise_storage(error)


@router.get("/uploads/{upload_session_id}/parts")
async def list_upload_parts(upload_session_id: UUID):
    try:
        upload, _, _ = _services()
        return await upload.list_multipart_parts(_actor(), upload_session_id)
    except StorageError as error:
        _raise_storage(error)


@router.delete("/uploads/{upload_session_id}")
async def abort_upload(upload_session_id: UUID):
    try:
        upload, _, _ = _services()
        return await upload.abort_upload(_actor(), upload_session_id)
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
