from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from server.clipping_persistence.models import AuthenticatedActor

from .config import MediaStorageConfig
from .errors import StorageError
from .models import (
    MediaAttachment,
    SignedMediaUrl,
    UploadInstructions,
)
from .paths import (
    ALLOWED_SOURCE_MIME_TYPES,
    source_object_path,
    validate_display_filename,
)
from .repository import MediaStorageRepository
from .storage import MediaStorage


def upload_request_hash(
    *,
    display_name: str,
    mime_type: str,
    size_bytes: int,
    media_asset_id: UUID | None,
    expected_revision: int | None,
) -> str:
    value = json.dumps(
        {
            "displayName": display_name,
            "mimeType": mime_type,
            "sizeBytes": size_bytes,
            "mediaAssetId": str(media_asset_id) if media_asset_id else None,
            "expectedRevision": expected_revision,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _media_kind(mime_type: str) -> str:
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("audio/"):
        return "audio"
    return "unknown"


class MediaUploadService:
    def __init__(
        self,
        *,
        config: MediaStorageConfig,
        storage: MediaStorage,
        repository: MediaStorageRepository,
    ) -> None:
        self.config = config
        self.storage = storage
        self.repository = repository

    def _validate_upload(
        self, *, display_name: str, mime_type: str, size_bytes: int
    ) -> tuple[str, str]:
        display_name = validate_display_filename(display_name)
        mime_type = mime_type.split(";", 1)[0].strip().lower()
        if mime_type not in ALLOWED_SOURCE_MIME_TYPES:
            raise StorageError(
                "upload_mime_mismatch",
                "Upload a supported video or audio file",
                {"mimeType": mime_type},
            )
        if size_bytes <= 0 or size_bytes > self.config.maximum_upload_bytes:
            raise StorageError(
                "upload_size_mismatch",
                "Declared upload size is outside the allowed range",
                {
                    "expectedSize": size_bytes,
                    "maximumSize": self.config.maximum_upload_bytes,
                },
            )
        return display_name, mime_type

    async def create_upload_session(
        self,
        actor: AuthenticatedActor,
        *,
        display_name: str,
        mime_type: str,
        size_bytes: int,
        idempotency_key: str,
        replace_media_asset_id: UUID | None = None,
        expected_revision: int | None = None,
    ) -> UploadInstructions:
        display_name, mime_type = self._validate_upload(
            display_name=display_name,
            mime_type=mime_type,
            size_bytes=size_bytes,
        )
        if not idempotency_key or len(idempotency_key) > 200:
            raise StorageError(
                "idempotency_conflict", "A valid idempotency key is required"
            )
        if replace_media_asset_id is not None:
            asset = await self.repository.get_asset(
                actor, replace_media_asset_id
            )
            if expected_revision is None:
                raise StorageError(
                    "stale_revision",
                    "Replacement requires the expected media revision",
                )
            media_asset_id = replace_media_asset_id
            path_version = expected_revision + 1
            if asset["revision"] != expected_revision:
                raise StorageError(
                    "stale_revision",
                    "Media asset revision is stale",
                    {
                        "expectedRevision": expected_revision,
                        "actualRevision": asset["revision"],
                    },
                )
        else:
            if expected_revision is not None:
                raise StorageError(
                    "stale_revision",
                    "Initial upload cannot specify an existing revision",
                )
            media_asset_id = uuid4()
            path_version = 1
        path = source_object_path(
            owner_user_id=actor.user_id,
            media_asset_id=media_asset_id,
            mime_type=mime_type,
            version=path_version,
        )
        expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=self.config.upload_session_ttl_seconds
        )
        request_hash = upload_request_hash(
            display_name=display_name,
            mime_type=mime_type,
            size_bytes=size_bytes,
            media_asset_id=replace_media_asset_id,
            expected_revision=expected_revision,
        )
        session, _, replayed = await self.repository.create_intent(
            actor,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            display_name=display_name,
            mime_type=mime_type,
            media_kind=_media_kind(mime_type),
            expected_size_bytes=size_bytes,
            storage_bucket=self.config.source_bucket,
            storage_path=path,
            expires_at=expires_at,
            media_asset_id=media_asset_id,
            replacement_of=replace_media_asset_id,
            expected_revision=expected_revision,
            maximum_active_uploads=self.config.maximum_active_uploads_per_user,
        )
        if session["status"] == "completed":
            raise StorageError(
                "upload_session_completed",
                "This upload session has already completed",
            )
        if session["expires_at"] <= datetime.now(timezone.utc):
            await self.repository.expire_if_due(actor, session["id"])
            raise StorageError(
                "upload_session_expired", "Upload session has expired"
            )
        # Authorization is ephemeral. If the provider is unavailable, retain
        # the durable `created` intent so the same idempotency key can retry
        # safely and receive a fresh token for the identical path.
        authorization = await self.storage.create_upload_session(
            bucket=session["storage_bucket"],
            path=session["storage_path"],
            mime_type=session["mime_type"],
        )
        await self.repository.mark_authorized(actor, session["id"])
        return UploadInstructions(
            media_asset_id=session["media_asset_id"],
            upload_session_id=session["id"],
            protocol=authorization.protocol,
            upload_url=authorization.upload_url,
            required_headers=authorization.required_headers,
            upload_metadata=authorization.upload_metadata,
            expires_at=session["expires_at"],
            maximum_size_bytes=self.config.maximum_upload_bytes,
            replayed=replayed,
        )

    async def get_upload_status(
        self, actor: AuthenticatedActor, upload_session_id: UUID
    ) -> dict[str, Any]:
        await self.repository.expire_if_due(actor, upload_session_id)
        session = await self.repository.get_session(actor, upload_session_id)
        return {
            "uploadSessionId": str(session["id"]),
            "mediaAssetId": str(session["media_asset_id"]),
            "protocol": session["upload_protocol"],
            "purpose": session["purpose"],
            "status": session["status"],
            "expectedSizeBytes": session["expected_size_bytes"],
            "receivedSizeBytes": session["received_size_bytes"],
            "expiresAt": session["expires_at"].isoformat(),
            "revision": session["revision"],
        }

    async def complete_media_upload(
        self,
        actor: AuthenticatedActor,
        upload_session_id: UUID,
        *,
        create_probe_job: bool = True,
    ) -> MediaAttachment:
        if await self.repository.expire_if_due(actor, upload_session_id):
            raise StorageError(
                "upload_session_expired", "Upload session has expired"
            )
        session = await self.repository.get_session(actor, upload_session_id)
        if session["status"] == "completed":
            asset = await self.repository.get_asset(
                actor, session["media_asset_id"]
            )
            return self.repository._attachment(asset)
        metadata = await self.storage.inspect_object(
            bucket=session["storage_bucket"], path=session["storage_path"]
        )
        if metadata.bucket != session["storage_bucket"] or (
            metadata.path != session["storage_path"]
        ):
            raise StorageError(
                "object_path_invalid",
                "Stored object identity does not match the upload session",
            )
        if metadata.size_bytes != session["expected_size_bytes"]:
            raise StorageError(
                "upload_size_mismatch",
                "Stored object size does not match the declared upload",
                {
                    "expectedSize": session["expected_size_bytes"],
                    "actualSize": metadata.size_bytes,
                },
            )
        if metadata.mime_type:
            actual_mime = metadata.mime_type.split(";", 1)[0].strip().lower()
            if actual_mime != session["mime_type"]:
                raise StorageError(
                    "upload_mime_mismatch",
                    "Stored object MIME type does not match the upload session",
                    {
                        "expectedMime": session["mime_type"],
                        "actualMime": actual_mime,
                    },
                )
        if session["expected_checksum"]:
            if (
                not metadata.checksum
                or metadata.checksum != session["expected_checksum"]
            ):
                raise StorageError(
                    "upload_checksum_mismatch",
                    "Stored object checksum does not match",
                )
        attachment = await self.repository.complete_verified(
            actor,
            upload_session_id,
            received_size_bytes=metadata.size_bytes,
            create_probe_job=create_probe_job,
        )
        if (
            session["purpose"] == "replacement"
            and session["previous_storage_bucket"]
            and session["previous_storage_path"]
        ):
            try:
                await self.storage.delete_object(
                    bucket=session["previous_storage_bucket"],
                    path=session["previous_storage_path"],
                )
            except StorageError:
                return MediaAttachment(
                    **{
                        **attachment.__dict__,
                        "cleanup_pending": True,
                    }
                )
        return attachment


class MediaAccessService:
    def __init__(
        self,
        *,
        config: MediaStorageConfig,
        storage: MediaStorage,
        repository: MediaStorageRepository,
    ) -> None:
        self.config = config
        self.storage = storage
        self.repository = repository

    async def _url(
        self,
        actor: AuthenticatedActor,
        media_asset_id: UUID,
        *,
        expires_in: int,
        download: bool,
    ) -> SignedMediaUrl:
        if expires_in <= 0 or expires_in > self.config.maximum_url_ttl_seconds:
            raise StorageError(
                "signed_url_failed",
                "Requested signed URL lifetime is outside the allowed range",
            )
        asset = await self.repository.get_asset(
            actor, media_asset_id, include_deleted=True
        )
        if asset["deleted_at"] is not None or asset["status"] == "deleted":
            raise StorageError("media_asset_deleted", "Media asset is deleted")
        if not asset["storage_bucket"] or not asset["storage_path"]:
            raise StorageError(
                "media_asset_not_ready", "Media asset has no verified object"
            )
        await self.storage.inspect_object(
            bucket=asset["storage_bucket"], path=asset["storage_path"]
        )
        if download:
            url = await self.storage.create_download_url(
                bucket=asset["storage_bucket"],
                path=asset["storage_path"],
                expires_in=expires_in,
                filename=asset["display_name"],
            )
            disposition = "attachment"
        else:
            url = await self.storage.create_read_url(
                bucket=asset["storage_bucket"],
                path=asset["storage_path"],
                expires_in=expires_in,
            )
            disposition = "inline"
        return SignedMediaUrl(
            media_asset_id=media_asset_id,
            url=url,
            expires_at=datetime.now(timezone.utc)
            + timedelta(seconds=expires_in),
            disposition=disposition,
        )

    async def create_media_preview_url(
        self,
        actor: AuthenticatedActor,
        media_asset_id: UUID,
        *,
        expires_in: int | None = None,
    ) -> SignedMediaUrl:
        return await self._url(
            actor,
            media_asset_id,
            expires_in=expires_in or self.config.preview_ttl_seconds,
            download=False,
        )

    async def create_media_download_url(
        self,
        actor: AuthenticatedActor,
        media_asset_id: UUID,
        *,
        expires_in: int | None = None,
    ) -> SignedMediaUrl:
        return await self._url(
            actor,
            media_asset_id,
            expires_in=expires_in or self.config.download_ttl_seconds,
            download=True,
        )


class MediaDeletionService:
    def __init__(
        self,
        *,
        storage: MediaStorage,
        repository: MediaStorageRepository,
    ) -> None:
        self.storage = storage
        self.repository = repository

    async def delete_media(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> dict[str, Any]:
        asset, already_deleted = await self.repository.begin_deletion(
            actor, media_asset_id
        )
        if already_deleted:
            return {"mediaAssetId": str(media_asset_id), "status": "deleted"}
        try:
            if asset["storage_bucket"] and asset["storage_path"]:
                await self.storage.delete_object(
                    bucket=asset["storage_bucket"], path=asset["storage_path"]
                )
        except StorageError as exc:
            await self.repository.fail_deletion(actor, media_asset_id)
            raise StorageError(
                "storage_delete_failed",
                "Media object deletion failed",
                {"mediaAssetId": str(media_asset_id)},
            ) from exc
        await self.repository.finish_deletion(actor, media_asset_id)
        return {"mediaAssetId": str(media_asset_id), "status": "deleted"}
