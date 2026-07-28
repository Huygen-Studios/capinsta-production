from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException

from ..auth import current_user
from ..clipping_exports.config import ClippingExportConfig
from ..clipping_exports.contracts import (
    ClippingExportRequestV1,
    PreviewRequestV1,
)
from ..clipping_exports.errors import ClippingExportError
from ..clipping_exports.repository import ClippingExportRepository
from ..clipping_orchestration.identity import validate_idempotency_key
from ..clipping_persistence.database import DurableDatabase
from ..clipping_persistence.errors import PersistenceError
from ..clipping_persistence.models import AuthenticatedActor
from ..clipping_storage.config import MediaStorageConfig
from ..clipping_storage.errors import StorageError
from ..clipping_storage.local_storage import LocalMediaStorage
from ..clipping_storage.supabase_storage import SupabaseMediaStorage

router = APIRouter(prefix="/clipping", tags=["clipping-exports"])


def _actor() -> AuthenticatedActor:
    return AuthenticatedActor.from_verified_user(current_user().id)


def _config(*, preview: bool = False) -> ClippingExportConfig:
    try:
        config = ClippingExportConfig.from_env()
    except ValueError as exc:
        raise HTTPException(
            503,
            detail={
                "code": "clipping_export_unavailable",
                "message": "Clipping export configuration is invalid",
            },
        ) from exc
    enabled = config.preview_api_enabled if preview else config.export_api_enabled
    if not enabled:
        raise HTTPException(
            404,
            detail={
                "code": "clipping_preview_disabled"
                if preview
                else "clipping_export_disabled",
                "message": "Clipping preview is disabled"
                if preview
                else "Clipping export is disabled",
            },
        )
    return config


def _repo(config):
    return ClippingExportRepository(DurableDatabase(), config)


def _key(value: str) -> str:
    try:
        return validate_idempotency_key(value)
    except ValueError as exc:
        raise HTTPException(
            400,
            detail={
                "code": "invalid_idempotency_key",
                "message": "Idempotency-Key is invalid",
            },
        ) from exc


def _raise(error):
    if isinstance(error, ClippingExportError):
        raise HTTPException(
            error.status_code,
            detail={"code": error.code, "message": error.safe_message},
        ) from error
    if isinstance(error, PersistenceError):
        raise HTTPException(
            503,
            detail={"code": "clipping_export_unavailable", "message": error.message},
        ) from error
    if isinstance(error, StorageError):
        status = 404 if error.category == "object_not_found" else 503
        raise HTTPException(
            status,
            detail={
                "code": "export_object_missing"
                if status == 404
                else "export_download_unavailable",
                "message": error.message,
            },
        ) from error


@router.post("/projects/{project_id}/preview", status_code=201)
async def prepare_preview(
    project_id: str,
    request: PreviewRequestV1,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    config = _config(preview=True)
    try:
        return await _repo(config).preview(
            _actor(), project_id, request, idempotency_key=_key(idempotency_key)
        )
    except (ClippingExportError, PersistenceError) as error:
        _raise(error)


@router.post("/projects/{project_id}/exports", status_code=201)
async def create_export(
    project_id: str,
    request: ClippingExportRequestV1,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    config = _config()
    key = _key(idempotency_key)
    from ..production.quotas import (
        QuotaExceededError,
        finish_reservation,
        reserve_export_admission,
    )

    try:
        reservation_key = await reserve_export_admission(
            user_id=current_user().id,
            project_id=project_id,
            idempotency_key=key,
        )
        result = await _repo(config).create(
            _actor(), project_id, request, idempotency_key=key
        )
        if reservation_key:
            await finish_reservation(reservation_key, committed=True)
        return result
    except QuotaExceededError as error:
        raise HTTPException(
            429,
            detail={"code": str(error), "message": "Your private-beta quota has been reached."},
        ) from error
    except (ClippingExportError, PersistenceError) as error:
        if 'reservation_key' in locals() and reservation_key:
            await finish_reservation(reservation_key, committed=False)
        _raise(error)


@router.get("/projects/{project_id}/exports")
async def list_exports(project_id: str):
    config = _config()
    try:
        return await _repo(config).list(_actor(), project_id)
    except (ClippingExportError, PersistenceError) as error:
        _raise(error)


@router.get("/exports/{export_id}")
async def export_status(export_id: UUID):
    config = _config()
    try:
        return await _repo(config).get(_actor(), export_id)
    except (ClippingExportError, PersistenceError) as error:
        _raise(error)


@router.post("/exports/{export_id}/cancel")
async def cancel_export(export_id: UUID):
    config = _config()
    try:
        return await _repo(config).cancel(_actor(), export_id)
    except (ClippingExportError, PersistenceError) as error:
        _raise(error)


@router.get("/exports/{export_id}/download")
async def download_export(export_id: UUID):
    config = _config()
    try:
        row = await _repo(config).download_record(_actor(), export_id)
        if config.storage_backend == "local":
            storage = LocalMediaStorage(Path(config.local_storage_root))
        else:
            storage = SupabaseMediaStorage(MediaStorageConfig.from_env())
        metadata = await storage.inspect_object(
            bucket=row["storage_bucket"], path=row["storage_path"]
        )
        if metadata.size_bytes != row["size_bytes"] or (
            metadata.checksum and metadata.checksum != row["checksum"]
        ):
            raise ClippingExportError(
                "export_object_conflict",
                "Stored export no longer matches its record",
                409,
            )
        url = await storage.create_download_url(
            bucket=row["storage_bucket"],
            path=row["storage_path"],
            expires_in=config.download_ttl_seconds,
            filename=f"capinsta-{export_id}.mp4",
        )
        return {
            "exportId": str(export_id),
            "url": url,
            "expiresInSeconds": config.download_ttl_seconds,
        }
    except (ClippingExportError, PersistenceError, StorageError) as error:
        _raise(error)
