from __future__ import annotations

import hashlib
import json
import logging
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
from .provider import media_storage_for_provider
from .repository import MediaStorageRepository
from .storage import MediaStorage

logger = logging.getLogger(__name__)


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


def _multipart_upload_id(session: dict[str, Any]) -> str | None:
    return session.get("provider_upload_id") or session.get("multipart_upload_id")


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
        self,
        *,
        display_name: str,
        mime_type: str,
        size_bytes: int,
        bucket_limit: int | None = None,
    ) -> tuple[str, str]:
        display_name = validate_display_filename(display_name)
        mime_type = mime_type.split(";", 1)[0].strip().lower()
        if mime_type not in ALLOWED_SOURCE_MIME_TYPES:
            raise StorageError(
                "upload_mime_mismatch",
                "Upload a supported video or audio file",
                {"mimeType": mime_type},
            )
        effective_limit = min(
            limit
            for limit in (self.config.maximum_upload_bytes, bucket_limit)
            if limit is not None
        )
        if size_bytes <= 0 or size_bytes > effective_limit:
            raise StorageError(
                "upload_size_mismatch",
                "Declared upload size is outside the allowed range",
                {
                    "expectedSize": size_bytes,
                    "maximumSize": effective_limit,
                    "applicationMaximumUploadBytes": self.config.maximum_upload_bytes,
                    "sourceBucketMaximumUploadBytes": bucket_limit,
                },
            )
        return display_name, mime_type

    async def upload_limits(self) -> dict[str, Any]:
        bucket_limit = (
            await self.repository.bucket_file_size_limit(self.config.source_bucket)
            if self.config.storage_provider == "supabase"
            else None
        )
        known_limits = [self.config.maximum_upload_bytes]
        if bucket_limit is not None:
            known_limits.append(bucket_limit)
        effective = min(known_limits)
        return {
            "applicationMaximumUploadBytes": self.config.maximum_upload_bytes,
            "sourceBucketMaximumUploadBytes": bucket_limit,
            "effectiveKnownMaximumUploadBytes": effective,
            "limitSource": "bucket"
            if bucket_limit is not None and bucket_limit <= self.config.maximum_upload_bytes
            else "application",
            "supabaseGlobalMaximumUploadBytes": None,
            "supabaseGlobalLimitKnown": False,
        }

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
        request_id: str | None = None,
    ) -> UploadInstructions:
        request_id = request_id or "-"
        if self.config.storage_provider == "r2":
            await self.repository.ensure_r2_schema()
        bucket_limit = (
            await self.repository.bucket_file_size_limit(self.config.source_bucket)
            if self.config.storage_provider == "supabase"
            else None
        )
        display_name, mime_type = self._validate_upload(
            display_name=display_name,
            mime_type=mime_type,
            size_bytes=size_bytes,
            bucket_limit=bucket_limit,
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
            storage_provider=self.config.storage_provider,
            storage_bucket=self.config.source_bucket,
            storage_path=path,
            upload_protocol=(
                "s3_multipart" if self.config.storage_provider == "r2" else "tus"
            ),
            expires_at=expires_at,
            media_asset_id=media_asset_id,
            replacement_of=replace_media_asset_id,
            expected_revision=expected_revision,
            maximum_active_uploads=self.config.maximum_active_uploads_per_user,
        )
        if session["status"] == "completed":
            return UploadInstructions(
                media_asset_id=session["media_asset_id"],
                upload_session_id=session["id"],
                protocol=session["upload_protocol"],
                upload_url=None,
                required_headers={},
                upload_metadata={},
                expires_at=session["expires_at"],
                maximum_size_bytes=session["expected_size_bytes"],
                source_bucket_maximum_upload_bytes=bucket_limit,
                effective_known_maximum_upload_bytes=bucket_limit,
                replayed=True,
                provider=self.config.storage_provider,
            )
        # Authorization is ephemeral. If the provider is unavailable, retain
        # the durable `created` intent so the same idempotency key can retry
        # safely and receive a fresh token for the identical path.
        if session["upload_protocol"] == "s3_multipart":
            part_size = self.config.r2_part_size_bytes
            part_count = (size_bytes + part_size - 1) // part_size
            if part_count > 10_000:
                raise StorageError(
                    "upload_size_mismatch",
                    "Upload requires too many multipart parts",
                    {"partCount": part_count},
                )
            new_upload = False
            async with self.repository.multipart_authorization_lock(
                actor, session["id"]
            ):
                session = await self.repository.get_session(actor, session["id"])
                if session["status"] == "completed":
                    raise StorageError(
                        "upload_session_completed",
                        "This upload session has already completed",
                    )
                if session["status"] in {"failed", "expired", "cancelled"}:
                    raise StorageError(
                        "upload_session_completed",
                        "Upload session is terminal",
                        {"status": session["status"]},
                    )
                provider_upload_id = _multipart_upload_id(session)
                if session["status"] == "authorized" and not provider_upload_id:
                    await self.repository.mark_failed(
                        actor, session["id"], code="missing_provider_upload_id"
                    )
                    raise StorageError(
                        "storage_persistence_failed",
                        "The media upload session could not be resumed",
                        {"stage": "multipart_persistence"},
                    )
                if session["status"] == "created" and provider_upload_id:
                    session = await self.repository.mark_authorized(
                        actor,
                        session["id"],
                        provider_upload_id=provider_upload_id,
                        multipart_part_size_bytes=part_size,
                        multipart_part_count=part_count,
                        signed_url_expires_at=datetime.now(timezone.utc)
                        + timedelta(seconds=self.config.r2_signed_url_ttl_seconds),
                    )
                elif not provider_upload_id:
                    authorization = await self.storage.create_upload_session(
                        bucket=session["storage_bucket"],
                        path=session["storage_path"],
                        mime_type=session["mime_type"],
                    )
                    provider_upload_id = authorization.provider_upload_id
                    new_upload = True
                    try:
                        session = await self.repository.mark_authorized(
                            actor,
                            session["id"],
                            provider_upload_id=provider_upload_id,
                            multipart_part_size_bytes=part_size,
                            multipart_part_count=part_count,
                            signed_url_expires_at=datetime.now(timezone.utc)
                            + timedelta(
                                seconds=self.config.r2_signed_url_ttl_seconds
                            ),
                        )
                    except Exception as error:
                        if provider_upload_id:
                            try:
                                await self.storage.abort_multipart_upload(
                                    bucket=session["storage_bucket"],
                                    path=session["storage_path"],
                                    upload_id=provider_upload_id,
                                )
                            except StorageError as abort_error:
                                logger.warning(
                                    "r2_multipart_abort_failed request_id=%s stage=multipart_persistence category=%s",
                                    request_id,
                                    abort_error.category,
                                )
                        try:
                            await self.repository.mark_failed(
                                actor,
                                session["id"],
                                code=(
                                    error.category
                                    if isinstance(error, StorageError)
                                    else "storage_persistence_failed"
                                ),
                            )
                        except Exception as mark_error:
                            logger.warning(
                                "r2_multipart_failure_record_failed request_id=%s stage=multipart_persistence exception_type=%s",
                                request_id,
                                type(mark_error).__name__,
                            )
                        logger.warning(
                            "r2_multipart_authorization_failed request_id=%s stage=multipart_persistence exception_type=%s category=%s",
                            request_id,
                            type(error).__name__,
                            (
                                error.category
                                if isinstance(error, StorageError)
                                else "storage_persistence_failed"
                            ),
                        )
                        if isinstance(error, StorageError):
                            raise StorageError(
                                error.category,
                                error.message,
                                {**error.details, "stage": "multipart_persistence"},
                            ) from error
                        raise StorageError(
                            "storage_persistence_failed",
                            "The media upload session could not be recorded",
                            {"stage": "multipart_persistence"},
                        ) from error
                session = await self.repository.get_session(actor, session["id"])
                provider_upload_id = _multipart_upload_id(session)
                if (
                    session["status"] != "authorized"
                    or not provider_upload_id
                    or not session.get("multipart_part_size_bytes")
                    or not session.get("multipart_part_count")
                ):
                    raise StorageError(
                        "storage_persistence_failed",
                        "The media upload session could not be verified",
                        {"stage": "multipart_persistence"},
                    )
            uploaded_parts = (
                []
                if new_upload
                else await self.storage.list_multipart_parts(
                    bucket=session["storage_bucket"],
                    path=session["storage_path"],
                    upload_id=provider_upload_id,
                )
            )
            return UploadInstructions(
                media_asset_id=session["media_asset_id"],
                upload_session_id=session["id"],
                protocol="s3_multipart",
                upload_url=None,
                required_headers={},
                upload_metadata={},
                expires_at=session["expires_at"],
                maximum_size_bytes=self.config.maximum_upload_bytes,
                source_bucket_maximum_upload_bytes=bucket_limit,
                effective_known_maximum_upload_bytes=min(
                    limit
                    for limit in (self.config.maximum_upload_bytes, bucket_limit)
                    if limit is not None
                ),
                limit_source=(
                    "bucket"
                    if bucket_limit is not None
                    and bucket_limit <= self.config.maximum_upload_bytes
                    else "application"
                ),
                replayed=replayed,
                provider="r2",
                part_size_bytes=session["multipart_part_size_bytes"] or part_size,
                part_count=session["multipart_part_count"] or part_count,
                upload_concurrency=self.config.r2_upload_concurrency,
                signed_url_ttl_seconds=self.config.r2_signed_url_ttl_seconds,
                uploaded_parts=uploaded_parts,
            )
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
            source_bucket_maximum_upload_bytes=bucket_limit,
            effective_known_maximum_upload_bytes=min(
                limit
                for limit in (self.config.maximum_upload_bytes, bucket_limit)
                if limit is not None
            ),
            limit_source=(
                "bucket"
                if bucket_limit is not None
                and bucket_limit <= self.config.maximum_upload_bytes
                else "application"
            ),
            replayed=replayed,
            provider=self.config.storage_provider,
        )

    async def sign_multipart_parts(
        self,
        actor: AuthenticatedActor,
        upload_session_id: UUID,
        *,
        part_numbers: list[int],
    ) -> dict[str, Any]:
        if not 1 <= len(part_numbers) <= self.config.r2_sign_batch_size:
            raise StorageError(
                "multipart_part_mismatch",
                f"Request between 1 and {self.config.r2_sign_batch_size} parts",
            )
        session = await self.repository.get_session(actor, upload_session_id)
        if session["upload_protocol"] != "s3_multipart":
            raise StorageError("multipart_part_mismatch", "Upload is not multipart")
        part_count = int(session["multipart_part_count"] or 0)
        normalized = sorted(set(part_numbers))
        if normalized != sorted(part_numbers) or any(
            part < 1 or part > part_count for part in normalized
        ):
            raise StorageError("multipart_part_mismatch", "Multipart part is invalid")
        expires_in = self.config.r2_signed_url_ttl_seconds
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        return {
            "uploadSessionId": str(upload_session_id),
            "parts": [
                {
                    "partNumber": part,
                    "url": await self.storage.create_upload_part_url(
                        bucket=session["storage_bucket"],
                        path=session["storage_path"],
                        upload_id=_multipart_upload_id(session),
                        part_number=part,
                        expires_in=expires_in,
                    ),
                    "expiresAt": expires_at.isoformat(),
                }
                for part in normalized
            ],
        }

    async def list_multipart_parts(
        self, actor: AuthenticatedActor, upload_session_id: UUID
    ) -> dict[str, Any]:
        session = await self.repository.get_session(actor, upload_session_id)
        if session["upload_protocol"] != "s3_multipart":
            raise StorageError("multipart_part_mismatch", "Upload is not multipart")
        return {
            "uploadSessionId": str(upload_session_id),
            "parts": await self.storage.list_multipart_parts(
                bucket=session["storage_bucket"],
                path=session["storage_path"],
                upload_id=_multipart_upload_id(session),
            ),
        }

    async def abort_upload(
        self, actor: AuthenticatedActor, upload_session_id: UUID
    ) -> dict[str, Any]:
        session = await self.repository.get_session(actor, upload_session_id)
        upload_id = _multipart_upload_id(session)
        if session["upload_protocol"] == "s3_multipart" and upload_id:
            await self.storage.abort_multipart_upload(
                bucket=session["storage_bucket"],
                path=session["storage_path"],
                upload_id=upload_id,
            )
        await self.repository.mark_failed(actor, upload_session_id, code="upload_cancelled")
        return {"uploadSessionId": str(upload_session_id), "status": "cancelled"}

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
        parts: list[dict[str, int | str]] | None = None,
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
        if session["upload_protocol"] == "s3_multipart":
            upload_id = _multipart_upload_id(session)
            if not upload_id:
                raise StorageError(
                    "multipart_upload_expired",
                    "Multipart upload authorization is missing",
                )
            listed = await self.storage.list_multipart_parts(
                bucket=session["storage_bucket"],
                path=session["storage_path"],
                upload_id=upload_id,
            )
            expected_count = int(session["multipart_part_count"] or 0)
            expected_size = int(session["expected_size_bytes"])
            part_size = int(session["multipart_part_size_bytes"] or 0)
            if len(listed) != expected_count:
                raise StorageError(
                    "multipart_part_mismatch",
                    "Uploaded part count does not match the expected count",
                    {"expectedPartCount": expected_count, "actualPartCount": len(listed)},
                )
            browser_etags = {
                int(part["partNumber"]): str(part["etag"]).strip('"')
                for part in (parts or [])
            }
            for part in listed:
                part_number = int(part["partNumber"])
                expected_part_size = (
                    expected_size - part_size * (expected_count - 1)
                    if part_number == expected_count
                    else part_size
                )
                if int(part["size"]) != expected_part_size:
                    raise StorageError(
                        "multipart_part_mismatch",
                        "Uploaded part size does not match the expected size",
                        {"partNumber": part_number},
                    )
                if browser_etags and browser_etags.get(part_number) != part["etag"]:
                    raise StorageError(
                        "multipart_etag_missing",
                        "Uploaded part ETag does not match Storage",
                        {"partNumber": part_number},
                    )
            metadata = await self.storage.complete_multipart_upload(
                bucket=session["storage_bucket"],
                path=session["storage_path"],
                upload_id=upload_id,
                parts=listed,
            )
            if metadata.size_bytes != expected_size:
                raise StorageError(
                    "object_size_mismatch", "Completed object size does not match"
                )
            return await self.repository.complete_verified(
                actor,
                upload_session_id,
                received_size_bytes=metadata.size_bytes,
                create_probe_job=create_probe_job,
                storage_etag=metadata.etag,
            )
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
            storage_etag=metadata.etag,
        )
        if (
            session["purpose"] == "replacement"
            and session["previous_storage_bucket"]
            and session["previous_storage_path"]
        ):
            try:
                previous_storage = media_storage_for_provider(
                    session.get("previous_storage_provider"), self.config
                )
                await previous_storage.delete_object(
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
        storage = media_storage_for_provider(asset.get("storage_provider"), self.config)
        await storage.inspect_object(
            bucket=asset["storage_bucket"], path=asset["storage_path"]
        )
        if download:
            url = await storage.create_download_url(
                bucket=asset["storage_bucket"],
                path=asset["storage_path"],
                expires_in=expires_in,
                filename=asset["display_name"],
            )
            disposition = "attachment"
        else:
            url = await storage.create_read_url(
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
        config: MediaStorageConfig,
        storage: MediaStorage,
        repository: MediaStorageRepository,
    ) -> None:
        self.config = config
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
                storage = media_storage_for_provider(
                    asset.get("storage_provider"), self.config
                )
                await storage.delete_object(
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
