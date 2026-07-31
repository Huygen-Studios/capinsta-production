from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.models import AuthenticatedActor
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.local_storage import LocalMediaStorage
from server.clipping_storage.provider import media_storage_from_config
from server.clipping_storage.repository import MediaStorageRepository
from server.clipping_storage.services import MediaDeletionService, MediaUploadService

logger = logging.getLogger(__name__)


class ClipperSessionService:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    async def get_or_create_session(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    SELECT * FROM automatic_clipper_sessions
                    WHERE media_asset_id=%s AND owner_user_id=%s AND deleted_at IS NULL
                    LIMIT 1
                    """,
                    (media_asset_id, actor.user_id),
                )
                row = await cursor.fetchone()
                if row:
                    return dict(row)
                await cursor.execute(
                    """
                    INSERT INTO automatic_clipper_sessions (
                      owner_user_id, media_asset_id, status, last_heartbeat_at
                    ) VALUES (%s, %s, 'active', now())
                    RETURNING *
                    """,
                    (actor.user_id, media_asset_id),
                )
                return dict(await cursor.fetchone())

    async def record_heartbeat(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE automatic_clipper_sessions
                    SET last_heartbeat_at=now(), updated_at=now()
                    WHERE media_asset_id=%s AND owner_user_id=%s AND deleted_at IS NULL
                    RETURNING *
                    """,
                    (media_asset_id, actor.user_id),
                )
                row = await cursor.fetchone()
                if row:
                    return dict(row)
        return await self.get_or_create_session(actor, media_asset_id)

    async def transfer_to_editor(
        self, actor: AuthenticatedActor, media_asset_id: UUID, clip_project_id: str
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE automatic_clipper_sessions
                    SET status='transferred_to_editor', clip_project_id=%s,
                        transferred_at=now(), preserve_until=NULL, updated_at=now()
                    WHERE media_asset_id=%s AND owner_user_id=%s AND deleted_at IS NULL
                    RETURNING *
                    """,
                    (clip_project_id, media_asset_id, actor.user_id),
                )
                row = await cursor.fetchone()
                if row:
                    return dict(row)
                await cursor.execute(
                    """
                    INSERT INTO automatic_clipper_sessions (
                      owner_user_id, media_asset_id, clip_project_id, status, transferred_at, last_heartbeat_at
                    ) VALUES (%s, %s, %s, 'transferred_to_editor', now(), now())
                    RETURNING *
                    """,
                    (actor.user_id, media_asset_id, clip_project_id),
                )
                return dict(await cursor.fetchone())

    async def request_abandonment(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE automatic_clipper_sessions
                    SET status='abandon_requested', abandon_requested_at=now(), updated_at=now()
                    WHERE media_asset_id=%s AND owner_user_id=%s AND deleted_at IS NULL
                    RETURNING *
                    """,
                    (media_asset_id, actor.user_id),
                )
                row = await cursor.fetchone()
                return dict(row) if row else {"mediaAssetId": str(media_asset_id), "status": "abandon_requested"}

    async def delete_session_media(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> dict[str, Any]:
        storage_config = MediaStorageConfig.from_env()
        storage = (
            media_storage_from_config(storage_config)
            if storage_config.enabled
            else LocalMediaStorage()
        )
        storage_repo = MediaStorageRepository(self.database)
        deletion_service = MediaDeletionService(
            config=storage_config, storage=storage, repository=storage_repo
        )
        upload_service = MediaUploadService(
            config=storage_config, storage=storage, repository=storage_repo
        )

        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                # Check session
                await cursor.execute(
                    """
                    SELECT * FROM automatic_clipper_sessions
                    WHERE media_asset_id=%s AND owner_user_id=%s AND deleted_at IS NULL
                    FOR UPDATE
                    """,
                    (media_asset_id, actor.user_id),
                )
                session_row = await cursor.fetchone()
                if session_row:
                    session = dict(session_row)
                    if session["status"] == "transferred_to_editor":
                        return {
                            "status": "transferred_and_protected",
                            "mediaAssetId": str(media_asset_id),
                        }
                    await cursor.execute(
                        "UPDATE automatic_clipper_sessions SET status='deleting', updated_at=now() WHERE id=%s",
                        (session["id"],),
                    )

                # Fence/cancel processing jobs
                await cursor.execute(
                    """
                    UPDATE processing_jobs
                    SET status='cancelled', finished_at=now(), updated_at=now()
                    WHERE media_asset_id=%s AND owner_user_id=%s
                      AND status IN ('queued', 'claimed', 'running', 'retry_wait')
                    """,
                    (media_asset_id, actor.user_id),
                )

                # Fetch active upload sessions to abort
                await cursor.execute(
                    """
                    SELECT id FROM media_upload_sessions
                    WHERE media_asset_id=%s AND owner_user_id=%s
                      AND status IN ('created', 'authorized')
                    """,
                    (media_asset_id, actor.user_id),
                )
                upload_session_rows = await cursor.fetchall()
                upload_session_ids = [row["id"] for row in upload_session_rows]

                # Fetch media variants storage info to delete objects
                await cursor.execute(
                    """
                    SELECT storage_bucket, storage_path, storage_provider FROM media_variants
                    WHERE media_asset_id=%s AND owner_user_id=%s
                    """,
                    (media_asset_id, actor.user_id),
                )
                variants = [dict(r) for r in await cursor.fetchall()]

        # Abort upload sessions
        for uid in upload_session_ids:
            try:
                await upload_service.abort_upload(actor, uid)
            except Exception as exc:
                logger.warning("abort_upload_failed upload_session_id=%s exc=%s", uid, exc)

        # Delete variant objects from storage
        for v in variants:
            bucket = v.get("storage_bucket")
            path = v.get("storage_path")
            if bucket and path:
                try:
                    await storage.delete_object(bucket=bucket, path=path)
                except Exception as exc:
                    logger.warning("delete_variant_object_failed path=%s exc=%s", path, exc)

        # Delete source media asset
        try:
            await deletion_service.delete_media(actor, media_asset_id)
        except Exception as exc:
            logger.warning("delete_source_media_failed media_asset_id=%s exc=%s", media_asset_id, exc)

        # Update session table to deleted
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE automatic_clipper_sessions
                    SET status='deleted', deleted_at=now(), updated_at=now()
                    WHERE media_asset_id=%s AND owner_user_id=%s AND deleted_at IS NULL
                    """,
                    (media_asset_id, actor.user_id),
                )

        return {"status": "deleted", "mediaAssetId": str(media_asset_id)}

    async def run_cleanup_sweep(
        self,
        *,
        batch_size: int = 50,
        abandon_grace_seconds: int = 300,
        source_retention_minutes: int = 5,
        export_retention_minutes: int = 30,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=abandon_grace_seconds)
        source_cutoff = datetime.now(timezone.utc) - timedelta(minutes=source_retention_minutes)
        export_cutoff = datetime.now(timezone.utc) - timedelta(minutes=export_retention_minutes)

        sessions_to_clean: list[dict[str, Any]] = []
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    SELECT s.media_asset_id, s.owner_user_id, s.status
                    FROM automatic_clipper_sessions s
                    WHERE s.deleted_at IS NULL
                      AND s.status NOT IN ('transferred_to_editor', 'deleted')
                      AND (
                        (s.last_heartbeat_at < %s AND (s.preserve_until IS NULL OR s.preserve_until <= now()))
                        OR (s.status = 'abandon_requested')
                        OR (s.completed_at IS NOT NULL AND s.completed_at < %s)
                      )
                    ORDER BY s.updated_at ASC
                    LIMIT %s
                    FOR UPDATE SKIP LOCKED
                    """,
                    (cutoff, source_cutoff, batch_size),
                )
                sessions_to_clean = [dict(row) for row in await cursor.fetchall()]

        cleaned_count = 0
        if not dry_run:
            for s in sessions_to_clean:
                try:
                    actor = AuthenticatedActor.from_verified_user(s["owner_user_id"])
                    await self.delete_session_media(actor, s["media_asset_id"])
                    cleaned_count += 1
                except Exception as exc:
                    logger.warning(
                        "clipper_session_cleanup_failed media_asset_id=%s exc=%s",
                        s["media_asset_id"],
                        exc,
                    )

        # Also cleanup expired export files
        expired_exports_count = 0
        if not dry_run:
            async with self.database.transaction() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE clipping_exports
                        SET status='deleted', deleted_at=now(), updated_at=now()
                        WHERE status='ready' AND ready_at < %s AND deleted_at IS NULL
                        RETURNING id
                        """,
                        (export_cutoff,),
                    )
                    expired_exports_count = len(await cursor.fetchall() or [])

        return {
            "sessionsFound": len(sessions_to_clean),
            "sessionsCleaned": cleaned_count,
            "expiredExportsDeleted": expired_exports_count,
            "dryRun": dry_run,
        }


__all__ = ["ClipperSessionService"]
