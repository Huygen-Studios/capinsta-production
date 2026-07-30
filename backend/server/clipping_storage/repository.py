from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError
from server.clipping_persistence.models import AuthenticatedActor
from server.clipping_persistence.repositories import IdempotencyRepository

from .errors import StorageError
from .models import MediaAttachment

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


R2_UPLOAD_SESSION_COLUMNS = frozenset(
    {
        "storage_provider",
        "previous_storage_provider",
        "provider_upload_id",
        "multipart_upload_id",
        "multipart_part_size_bytes",
        "multipart_part_count",
        "multipart_state",
        "signed_url_expires_at",
        "aborted_at",
    }
)
R2_UPLOAD_SESSION_CONSTRAINTS = {
    "media_upload_sessions_storage_provider_check": ("r2",),
    "media_upload_sessions_protocol_check": ("s3_multipart",),
    "media_upload_sessions_multipart_check": ("created", "completed", "aborted"),
}


def r2_schema_findings(
    columns: set[str], constraints: dict[str, str]
) -> list[str]:
    findings = [
        f"missing_column:{name}"
        for name in sorted(R2_UPLOAD_SESSION_COLUMNS - columns)
    ]
    for name, values in R2_UPLOAD_SESSION_CONSTRAINTS.items():
        definition = constraints.get(name, "").lower()
        if not definition or any(value not in definition for value in values):
            findings.append(f"invalid_constraint:{name}")
    return findings


def _sqlstate(exc: BaseException) -> str | None:
    current: BaseException | None = exc
    while current is not None:
        state = getattr(current, "sqlstate", None)
        if state:
            return str(state)
        current = current.__cause__
    return None


def _translate(exc: PersistenceError | Exception) -> StorageError:
    state = _sqlstate(exc)
    if state in {"42703", "42P01"}:
        return StorageError(
            "storage_schema_outdated",
            "The media database migration is incomplete. Apply migration 0028.",
            {"stage": "multipart_persistence"},
        )
    if state in {"23502", "23514"}:
        return StorageError(
            "storage_persistence_failed",
            "The media upload session could not be recorded",
            {"stage": "multipart_persistence"},
        )
    if state and state.startswith("08"):
        return StorageError(
            "storage_provider_unavailable",
            "The media database is temporarily unavailable",
            {"stage": "multipart_persistence"},
        )
    if not isinstance(exc, PersistenceError):
        return StorageError(
            "storage_persistence_failed",
            "The media upload session could not be recorded",
            {"stage": "multipart_persistence"},
        )
    category = {
        "idempotency_conflict": "idempotency_conflict",
        "idempotency_in_progress": "idempotency_in_progress",
        "stale_revision": "stale_revision",
        "database_unavailable": "storage_provider_unavailable",
        "transaction_failed": "storage_persistence_failed",
    }.get(exc.category, "storage_persistence_failed")
    return StorageError(category, exc.message, exc.details)


class MediaStorageRepository:
    """Transactional upload/media lifecycle persistence."""

    def __init__(self, database: DurableDatabase) -> None:
        self.database = database
        self.idempotency = IdempotencyRepository(database)

    async def ensure_r2_schema(self) -> None:
        try:
            async with self.database.connection() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        SELECT column_name FROM information_schema.columns
                        WHERE table_schema='public'
                          AND table_name='media_upload_sessions'
                        """
                    )
                    columns = {str(row["column_name"]) for row in await cursor.fetchall()}
                    await cursor.execute(
                        """
                        SELECT conname,pg_get_constraintdef(oid) AS definition
                        FROM pg_constraint
                        WHERE conrelid=to_regclass('public.media_upload_sessions')
                        """
                    )
                    constraints = {
                        str(row["conname"]): str(row["definition"])
                        for row in await cursor.fetchall()
                    }
        except PersistenceError as exc:
            raise _translate(exc) from exc
        if r2_schema_findings(columns, constraints):
            raise StorageError(
                "storage_schema_outdated",
                "The media database migration is incomplete. Apply migration 0028.",
                {"stage": "schema_readiness"},
            )

    @asynccontextmanager
    async def multipart_authorization_lock(
        self, actor: AuthenticatedActor, session_id: UUID
    ):
        try:
            async with self.database.transaction() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                        (f"{actor.user_id}:{session_id}:r2_authorize",),
                    )
                yield
        except PersistenceError as exc:
            raise _translate(exc) from exc

    @staticmethod
    async def _session(
        connection: Any,
        actor: AuthenticatedActor,
        session_id: UUID,
        *,
        lock: bool = False,
    ) -> dict[str, Any]:
        suffix = " FOR UPDATE" if lock else ""
        async with connection.cursor() as cursor:
            await cursor.execute(
                f"""
                SELECT * FROM media_upload_sessions
                WHERE id=%s AND owner_user_id=%s{suffix}
                """,
                (session_id, actor.user_id),
            )
            row = await cursor.fetchone()
        if row is None:
            raise StorageError(
                "upload_session_not_found",
                "Upload session was not found",
                {"uploadSessionId": str(session_id)},
            )
        return dict(row)

    @staticmethod
    async def _asset(
        connection: Any,
        actor: AuthenticatedActor,
        asset_id: UUID,
        *,
        lock: bool = False,
        include_deleted: bool = False,
    ) -> dict[str, Any]:
        suffix = " FOR UPDATE" if lock else ""
        deleted = "" if include_deleted else " AND deleted_at IS NULL"
        async with connection.cursor() as cursor:
            await cursor.execute(
                f"""
                SELECT * FROM media_assets
                WHERE id=%s AND owner_user_id=%s{deleted}{suffix}
                """,
                (asset_id, actor.user_id),
            )
            row = await cursor.fetchone()
        if row is None:
            raise StorageError(
                "media_asset_deleted" if include_deleted else "media_asset_not_ready",
                "Media asset was not found",
                {"mediaAssetId": str(asset_id)},
            )
        return dict(row)

    async def create_intent(
        self,
        actor: AuthenticatedActor,
        *,
        idempotency_key: str,
        request_hash: str,
        display_name: str,
        mime_type: str,
        media_kind: str,
        expected_size_bytes: int,
        storage_bucket: str,
        storage_path: str,
        storage_provider: str = "supabase",
        upload_protocol: str = "tus",
        expires_at: datetime,
        media_asset_id: UUID,
        replacement_of: UUID | None = None,
        expected_revision: int | None = None,
        maximum_active_uploads: int = 2,
    ) -> tuple[dict[str, Any], dict[str, Any], bool]:
        scope = f"{actor.user_id}:media_upload"
        try:
            async with self.database.transaction() as connection:
                record, created = await self.idempotency._begin(
                    connection,
                    actor,
                    scope=scope,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    expires_at=expires_at,
                )
                if not created:
                    if record["request_hash"] != request_hash:
                        raise StorageError(
                            "idempotency_conflict",
                            "Idempotency key was reused for another upload",
                        )
                    if record["resource_id"]:
                        session = await self._session(
                            connection,
                            actor,
                            UUID(record["resource_id"]),
                            lock=True,
                        )
                        asset = await self._asset(
                            connection,
                            actor,
                            session["media_asset_id"],
                            include_deleted=True,
                        )
                        return session, asset, True
                    raise StorageError(
                        "idempotency_in_progress",
                        "Upload creation is already in progress",
                    )

                async with connection.cursor() as cursor:
                    await cursor.execute(
                        "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                        (f"{actor.user_id}:media_upload",),
                    )
                    await cursor.execute(
                        """
                        SELECT count(*) FROM media_upload_sessions
                        WHERE owner_user_id=%s
                          AND status IN ('created','authorized','uploading','uploaded','verifying')
                          AND expires_at > now()
                        """,
                        (actor.user_id,),
                    )
                    if int((await cursor.fetchone())["count"]) >= maximum_active_uploads:
                        raise StorageError(
                            "active_upload_limit_exceeded",
                            "Finish or cancel an active upload before starting another",
                        )

                if replacement_of is None:
                    async with connection.cursor() as cursor:
                        await cursor.execute(
                            """
                            INSERT INTO media_assets (
                              id,owner_user_id,display_name,mime_type,media_kind,
                              source_type,size_bytes,status,metadata
                            ) VALUES (%s,%s,%s,%s,%s,'uploaded',%s,
                              'pending_upload','{}'::jsonb)
                            RETURNING *
                            """,
                            (
                                media_asset_id,
                                actor.user_id,
                                display_name,
                                mime_type,
                                media_kind,
                                expected_size_bytes,
                            ),
                        )
                        asset = dict(await cursor.fetchone())
                    purpose = "initial"
                    replacement_revision = None
                    previous_provider = None
                    previous_bucket = None
                    previous_path = None
                else:
                    asset = await self._asset(
                        connection, actor, replacement_of, lock=True
                    )
                    if expected_revision is None or asset["revision"] != expected_revision:
                        raise StorageError(
                            "stale_revision",
                            "Media asset revision is stale",
                            {
                                "expectedRevision": expected_revision,
                                "actualRevision": asset["revision"],
                            },
                        )
                    media_asset_id = replacement_of
                    purpose = "replacement"
                    replacement_revision = expected_revision + 1
                    previous_bucket = asset["storage_bucket"]
                    previous_path = asset["storage_path"]
                    previous_provider = asset.get("storage_provider") or "supabase"

                session_id = uuid4()
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        INSERT INTO media_upload_sessions (
                          id,owner_user_id,media_asset_id,storage_provider,storage_bucket,
                          storage_path,upload_protocol,purpose,status,
                          expected_size_bytes,display_name,mime_type,replacement_revision,
                          previous_storage_provider,previous_storage_bucket,
                          previous_storage_path,expires_at
                        ) VALUES (
                          %s,%s,%s,%s,%s,%s,%s,%s,'created',%s,%s,%s,%s,%s,%s,%s,%s
                        ) RETURNING *
                        """,
                        (
                            session_id,
                            actor.user_id,
                            media_asset_id,
                            storage_provider,
                            storage_bucket,
                            storage_path,
                            upload_protocol,
                            purpose,
                            expected_size_bytes,
                            display_name,
                            mime_type,
                            replacement_revision,
                            previous_provider if replacement_of is not None else None,
                            previous_bucket,
                            previous_path,
                            expires_at,
                        ),
                    )
                    session = dict(await cursor.fetchone())
                    await cursor.execute(
                        """
                        UPDATE idempotency_records SET status='completed',
                          response_code=201,resource_type='media_upload_session',
                          resource_id=%s,response=%s,updated_at=now()
                        WHERE id=%s
                        """,
                        (
                            str(session_id),
                            _json(
                                {
                                    "mediaAssetId": str(media_asset_id),
                                    "uploadSessionId": str(session_id),
                                }
                            ),
                            record["id"],
                        ),
                    )
                return session, asset, False
        except PersistenceError as exc:
            raise _translate(exc) from exc

    async def mark_authorized(
        self,
        actor: AuthenticatedActor,
        session_id: UUID,
        *,
        provider_upload_id: str | None = None,
        multipart_part_size_bytes: int | None = None,
        multipart_part_count: int | None = None,
        signed_url_expires_at: datetime | None = None,
    ) -> dict[str, Any]:
        try:
            async with self.database.transaction() as connection:
                session = await self._session(
                    connection, actor, session_id, lock=True
                )
                if session["status"] == "authorized":
                    return session
                if session["status"] != "created":
                    raise StorageError(
                        "upload_session_completed",
                        "Upload session cannot be authorized in its current state",
                        {"status": session["status"]},
                    )
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE media_upload_sessions SET status='authorized',
                          provider_upload_id=COALESCE(%s,provider_upload_id),
                          multipart_upload_id=COALESCE(%s,multipart_upload_id),
                          multipart_part_size_bytes=COALESCE(%s,multipart_part_size_bytes),
                          multipart_part_count=COALESCE(%s,multipart_part_count),
                          multipart_state=CASE WHEN %s::text IS NULL THEN multipart_state ELSE 'created' END,
                          signed_url_expires_at=COALESCE(%s,signed_url_expires_at),
                          revision=revision+1,updated_at=now()
                        WHERE id=%s RETURNING *
                        """,
                        (
                            provider_upload_id,
                            provider_upload_id,
                            multipart_part_size_bytes,
                            multipart_part_count,
                            provider_upload_id,
                            signed_url_expires_at,
                            session_id,
                        ),
                    )
                    return dict(await cursor.fetchone())
        except StorageError:
            raise
        except Exception as exc:
            raise _translate(exc) from exc

    async def bucket_file_size_limit(self, bucket: str) -> int | None:
        try:
            async with self.database.connection() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        SELECT file_size_limit FROM storage.buckets
                        WHERE id=%s AND public=false
                        """,
                        (bucket,),
                    )
                    row = await cursor.fetchone()
                    if not row or row["file_size_limit"] is None:
                        return None
                    return int(row["file_size_limit"])
        except Exception:
            return None

    async def mark_failed(
        self,
        actor: AuthenticatedActor,
        session_id: UUID,
        *,
        code: str,
    ) -> None:
        try:
            async with self.database.transaction() as connection:
                session = await self._session(
                    connection, actor, session_id, lock=True
                )
                if session["status"] in {"completed", "failed", "expired", "cancelled"}:
                    return
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE media_upload_sessions SET status='failed',
                          failed_at=now(),error=%s,revision=revision+1,updated_at=now()
                        WHERE id=%s
                        """,
                        (_json({"code": code}), session_id),
                    )
                    if session["purpose"] == "initial":
                        await cursor.execute(
                            """
                            UPDATE media_assets SET status='failed',
                              revision=revision+1,updated_at=now()
                            WHERE id=%s AND owner_user_id=%s
                            """,
                            (session["media_asset_id"], actor.user_id),
                        )
        except StorageError:
            raise
        except Exception as exc:
            raise _translate(exc) from exc

    async def expire_if_due(
        self, actor: AuthenticatedActor, session_id: UUID
    ) -> bool:
        async with self.database.transaction() as connection:
            session = await self._session(
                connection, actor, session_id, lock=True
            )
            if session["status"] == "completed":
                return False
            if session["expires_at"] > datetime.now(timezone.utc):
                return False
            if session["status"] not in {"failed", "expired", "cancelled"}:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE media_upload_sessions SET status='expired',
                          revision=revision+1,updated_at=now() WHERE id=%s
                        """,
                        (session_id,),
                    )
            return True

    async def get_session(
        self, actor: AuthenticatedActor, session_id: UUID
    ) -> dict[str, Any]:
        try:
            async with self.database.connection() as connection:
                return await self._session(connection, actor, session_id)
        except StorageError:
            raise
        except Exception as exc:
            raise _translate(exc) from exc

    async def get_asset(
        self,
        actor: AuthenticatedActor,
        media_asset_id: UUID,
        *,
        include_deleted: bool = False,
    ) -> dict[str, Any]:
        try:
            async with self.database.connection() as connection:
                return await self._asset(
                    connection,
                    actor,
                    media_asset_id,
                    include_deleted=include_deleted,
                )
        except StorageError:
            raise
        except Exception as exc:
            raise _translate(exc) from exc

    async def complete_verified(
        self,
        actor: AuthenticatedActor,
        session_id: UUID,
        *,
        received_size_bytes: int,
        create_probe_job: bool,
        storage_etag: str | None = None,
    ) -> MediaAttachment:
        async with self.database.transaction() as connection:
            session = await self._session(
                connection, actor, session_id, lock=True
            )
            asset = await self._asset(
                connection, actor, session["media_asset_id"], lock=True
            )
            if session["status"] == "completed":
                return self._attachment(asset)
            if session["status"] in {"failed", "expired", "cancelled"}:
                raise StorageError(
                    "upload_session_completed",
                    "Upload session is terminal",
                    {"status": session["status"]},
                )
            if session["expires_at"] <= datetime.now(timezone.utc):
                raise StorageError(
                    "upload_session_expired", "Upload session has expired"
                )
            expected_asset_revision = (
                1
                if session["purpose"] == "initial"
                else session["replacement_revision"] - 1
            )
            if asset["revision"] != expected_asset_revision:
                raise StorageError(
                    "stale_revision",
                    "Media asset changed before upload completion",
                    {
                        "expectedRevision": expected_asset_revision,
                        "actualRevision": asset["revision"],
                    },
                )
            job_id = uuid4() if create_probe_job else None
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE media_upload_sessions SET status='completed',
                      received_size_bytes=%s,completed_at=now(),
                      multipart_state=CASE
                        WHEN upload_protocol='s3_multipart' THEN 'completed'
                        ELSE multipart_state
                      END,
                      revision=revision+1,updated_at=now()
                    WHERE id=%s
                    """,
                    (received_size_bytes, session_id),
                )
                await cursor.execute(
                    """
                    UPDATE media_assets SET storage_bucket=%s,storage_path=%s,
                      display_name=%s,mime_type=%s,size_bytes=%s,status='ready_for_probe',
                      storage_provider=%s,storage_etag=%s,
                      storage_object_revision=%s,probe_result_identity=NULL,
                      revision=revision+1,updated_at=now()
                    WHERE id=%s AND owner_user_id=%s RETURNING *
                    """,
                    (
                        session["storage_bucket"],
                        session["storage_path"],
                        session["display_name"],
                        session["mime_type"],
                        received_size_bytes,
                        session.get("storage_provider") or "supabase",
                        storage_etag,
                        (
                            session["replacement_revision"]
                            if session["purpose"] == "replacement"
                            else 1
                        ),
                        session["media_asset_id"],
                        actor.user_id,
                    ),
                )
                asset = dict(await cursor.fetchone())
                if job_id is not None:
                    await cursor.execute(
                        """
                        INSERT INTO processing_jobs (
                          id,owner_user_id,media_asset_id,job_type,status,input
                        ) VALUES (%s,%s,%s,'media_probe','queued',%s)
                        """,
                        (
                            job_id,
                            actor.user_id,
                            asset["id"],
                            _json(
                                {
                                    "schemaVersion": 1,
                                    "jobType": "media_probe",
                                    "mediaAssetId": str(asset["id"]),
                                    "expectedMediaRevision": asset["revision"],
                                    "storageObjectRevision": (
                                        asset["storage_object_revision"]
                                    ),
                                    "requestedFields": None,
                                    "metadata": {
                                        "uploadSessionId": str(session_id)
                                    },
                                }
                            ),
                        ),
                    )
            return self._attachment(asset, media_probe_job_id=job_id)

    @staticmethod
    def _attachment(
        asset: dict[str, Any],
        *,
        media_probe_job_id: UUID | None = None,
        cleanup_pending: bool = False,
    ) -> MediaAttachment:
        return MediaAttachment(
            media_asset_id=asset["id"],
            storage_provider=asset.get("storage_provider") or "supabase",
            storage_bucket=asset["storage_bucket"],
            storage_path=asset["storage_path"],
            display_name=asset["display_name"],
            mime_type=asset["mime_type"],
            size_bytes=int(asset["size_bytes"]),
            status=asset["status"],
            media_probe_job_id=media_probe_job_id,
            cleanup_pending=cleanup_pending,
        )

    async def begin_deletion(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> tuple[dict[str, Any], bool]:
        async with self.database.transaction() as connection:
            asset = await self._asset(
                connection,
                actor,
                media_asset_id,
                lock=True,
                include_deleted=True,
            )
            if asset["deleted_at"] is not None or asset["status"] == "deleted":
                return asset, True
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    SELECT 1 FROM clip_projects
                    WHERE owner_user_id=%s AND source_media_asset_id=%s
                      AND deleted_at IS NULL AND status <> 'archived'
                    LIMIT 1
                    """,
                    (actor.user_id, media_asset_id),
                )
                if await cursor.fetchone():
                    raise StorageError(
                        "media_asset_not_ready",
                        "Media is still referenced by an active clip project",
                    )
                await cursor.execute(
                    """
                    UPDATE media_assets SET status='deletion_pending',
                      revision=revision+1,updated_at=now()
                    WHERE id=%s RETURNING *
                    """,
                    (media_asset_id,),
                )
                return dict(await cursor.fetchone()), False

    async def finish_deletion(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            await self._asset(
                connection,
                actor,
                media_asset_id,
                lock=True,
                include_deleted=True,
            )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE media_assets SET status='deleted',
                      deleted_at=COALESCE(deleted_at,now()),
                      revision=revision+1,updated_at=now()
                    WHERE id=%s AND owner_user_id=%s RETURNING *
                    """,
                    (media_asset_id, actor.user_id),
                )
                return dict(await cursor.fetchone())

    async def fail_deletion(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> None:
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE media_assets SET status='deletion_failed',
                      revision=revision+1,updated_at=now()
                    WHERE id=%s AND owner_user_id=%s AND deleted_at IS NULL
                    """,
                    (media_asset_id, actor.user_id),
                )
