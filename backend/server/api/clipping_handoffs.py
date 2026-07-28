from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query

from ..auth import current_user
from ..clipping_handoff.config import HandoffConfig
from ..clipping_handoff.contracts import (
    CompleteHandoffRequestV1,
    PrepareHandoffRequestV1,
)
from ..clipping_handoff.errors import HandoffError
from ..clipping_handoff.repository import HandoffRepository
from ..clipping_orchestration.identity import validate_idempotency_key
from ..clipping_persistence.database import DurableDatabase
from ..clipping_persistence.errors import PersistenceError
from ..clipping_persistence.models import AuthenticatedActor
from ..clipping_storage.config import MediaStorageConfig
from ..clipping_storage.errors import StorageError
from ..clipping_storage.repository import MediaStorageRepository
from ..clipping_storage.supabase_storage import SupabaseMediaStorage

router = APIRouter(prefix="/clipping", tags=["clipping-handoffs"])
media_router = APIRouter(prefix="/capinsta/media", tags=["capinsta-media"])


def _actor() -> AuthenticatedActor:
    return AuthenticatedActor.from_verified_user(current_user().id)


def _config() -> HandoffConfig:
    try:
        config = HandoffConfig.from_env()
    except ValueError as exc:
        raise HTTPException(
            503,
            detail={
                "code": "handoff_unavailable",
                "message": "Project handoff configuration is invalid",
            },
        ) from exc
    if not config.enabled:
        raise HTTPException(
            404,
            detail={
                "code": "handoff_disabled",
                "message": "Project handoff is disabled",
            },
        )
    return config


def _repository(config: HandoffConfig) -> HandoffRepository:
    return HandoffRepository(DurableDatabase(), config)


def _raise_handoff(error: HandoffError) -> None:
    raise HTTPException(
        error.status_code,
        detail={"code": error.code, "message": error.safe_message},
    ) from error


def _raise_error(error: HandoffError | PersistenceError) -> None:
    if isinstance(error, HandoffError):
        _raise_handoff(error)
    status = 503 if error.category in {
        "database_unavailable",
        "transaction_failed",
    } else 422
    raise HTTPException(
        status,
        detail={"code": error.category, "message": error.message},
    ) from error


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


@router.post("/projects/{project_id}/handoff", status_code=201)
async def prepare_handoff(
    project_id: str,
    request: PrepareHandoffRequestV1,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    config = _config()
    if not config.server_backed_media_enabled:
        raise HTTPException(
            404,
            detail={
                "code": "server_backed_media_disabled",
                "message": "Server-backed editor media is disabled",
            },
        )
    try:
        return await _repository(config).prepare(
            _actor(),
            project_id,
            request,
            idempotency_key=_key(idempotency_key),
        )
    except (HandoffError, PersistenceError) as error:
        _raise_error(error)


@router.get("/handoffs/{handoff_id}")
async def handoff_status(handoff_id: UUID):
    config = _config()
    try:
        return await _repository(config).status(_actor(), handoff_id)
    except (HandoffError, PersistenceError) as error:
        _raise_error(error)


@router.post("/handoffs/{handoff_id}/claim")
async def claim_handoff(handoff_id: UUID):
    config = _config()
    try:
        return await _repository(config).claim(_actor(), handoff_id)
    except (HandoffError, PersistenceError) as error:
        _raise_error(error)


@router.post("/handoffs/{handoff_id}/complete")
async def complete_handoff(
    handoff_id: UUID, request: CompleteHandoffRequestV1
):
    config = _config()
    try:
        return await _repository(config).complete(_actor(), handoff_id, request)
    except (HandoffError, PersistenceError) as error:
        _raise_error(error)


@router.post("/handoffs/{handoff_id}/cancel")
async def cancel_handoff(handoff_id: UUID):
    config = _config()
    try:
        return await _repository(config).cancel(_actor(), handoff_id)
    except (HandoffError, PersistenceError) as error:
        _raise_error(error)


@media_router.post("/{media_asset_id}/access")
async def resolve_media_access(
    media_asset_id: UUID,
    expires_in: int | None = Query(default=None, alias="expiresIn", ge=1),
):
    handoff_config = _config()
    if not handoff_config.server_backed_media_enabled:
        raise HTTPException(
            404,
            detail={
                "code": "server_backed_media_disabled",
                "message": "Server-backed editor media is disabled",
            },
        )
    storage_config = MediaStorageConfig.from_env()
    if not storage_config.enabled:
        raise HTTPException(
            503,
            detail={
                "code": "media_access_unavailable",
                "message": "Durable media storage is unavailable",
            },
        )
    actor = _actor()
    database = DurableDatabase()
    repository = MediaStorageRepository(database)
    storage = SupabaseMediaStorage(storage_config)
    try:
        asset = await repository.get_asset(
            actor, media_asset_id, include_deleted=True
        )
        async with database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    SELECT * FROM media_variants
                    WHERE media_asset_id=%s AND variant_type='proxy'
                      AND source_media_revision=%s AND status='ready'
                      AND deleted_at IS NULL
                      AND storage_bucket IS NOT NULL AND storage_path IS NOT NULL
                    ORDER BY ready_at DESC,id DESC LIMIT 1
                    """,
                    (media_asset_id, asset["revision"]),
                )
                proxy = await cursor.fetchone()
        if proxy is None:
            raise StorageError(
                "media_proxy_not_ready",
                "The editing proxy is not ready",
            )
        ttl = expires_in or storage_config.preview_ttl_seconds
        if ttl > storage_config.maximum_url_ttl_seconds:
            raise StorageError(
                "signed_url_failed",
                "Requested signed URL lifetime is outside the allowed range",
            )
        url = await storage.create_read_url(
            bucket=proxy["storage_bucket"],
            path=proxy["storage_path"],
            expires_in=ttl,
        )
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl)
    except (StorageError, PersistenceError) as error:
        if isinstance(error, PersistenceError):
            raise HTTPException(
                503,
                detail={
                    "code": "media_access_unavailable",
                    "message": error.message,
                },
            ) from error
        status = {
            "storage_permission_denied": 403,
            "media_asset_deleted": 410,
            "media_asset_not_ready": 409,
            "media_proxy_not_ready": 409,
            "object_not_found": 404,
            "signed_url_failed": 502,
            "storage_provider_unavailable": 503,
        }.get(error.category, 422)
        raise HTTPException(
            status,
            detail={
                "code": (
                    "media_access_unavailable"
                    if status >= 500
                    else error.category
                ),
                "message": error.message,
            },
        ) from error
    return {
        "mediaAssetId": str(media_asset_id),
        "mediaId": str(media_asset_id),
        "accessMode": "signed-url",
        "url": url,
        "expiresAt": expires_at.isoformat(),
        "mimeType": proxy["mime_type"],
        "sizeBytes": proxy["size_bytes"],
        "durationMs": proxy["duration_ms"] or asset["duration_ms"],
        "variantType": "proxy",
    }
