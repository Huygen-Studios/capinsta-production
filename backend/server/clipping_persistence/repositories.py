from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from pydantic import ValidationError

from .database import DurableDatabase
from .errors import PersistenceError
from .models import (
    ALLOWED_JOB_TRANSITIONS,
    TERMINAL_JOB_STATUSES,
    AuthenticatedActor,
    validate_job_input,
)
from .validation import (
    ensure_portable_json,
    validate_clip_project,
    validate_derived_caches,
    validate_transcript,
)

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


def _row(value: Any) -> dict[str, Any] | None:
    return dict(value) if value is not None else None


def _not_found(entity_type: str, entity_id: object) -> PersistenceError:
    return PersistenceError(
        "entity_not_found",
        f"{entity_type} was not found",
        {"entityType": entity_type, "entityId": str(entity_id)},
    )


async def _owned_row(
    connection: Any,
    table: str,
    entity_id: object,
    actor: AuthenticatedActor,
    *,
    for_update: bool = False,
) -> dict[str, Any]:
    query = f'SELECT * FROM "{table}" WHERE id = %s AND owner_user_id = %s'
    if for_update:
        query += " FOR UPDATE"
    async with connection.cursor() as cursor:
        await cursor.execute(query, (entity_id, actor.user_id))
        row = await cursor.fetchone()
    if row is None:
        raise _not_found(table, entity_id)
    return dict(row)


class MediaAssetRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    async def create(
        self,
        actor: AuthenticatedActor,
        *,
        display_name: str,
        media_kind: str = "unknown",
        source_type: str = "unknown",
        media_asset_id: UUID | None = None,
        mime_type: str | None = None,
        duration_ms: int | None = None,
        width: int | None = None,
        height: int | None = None,
        fps_numerator: int | None = None,
        fps_denominator: int | None = None,
        size_bytes: int | None = None,
        checksum: str | None = None,
        status: str = "pending",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        entity_id = media_asset_id or uuid4()
        metadata = metadata or {}
        ensure_portable_json(metadata)
        query = """
            INSERT INTO media_assets (
              id, owner_user_id, display_name, mime_type, media_kind, source_type,
              duration_ms, width, height, fps_numerator, fps_denominator,
              size_bytes, checksum, status, metadata
            ) VALUES (
              %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
            ) RETURNING *
        """
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    query,
                    (
                        entity_id,
                        actor.user_id,
                        display_name,
                        mime_type,
                        media_kind,
                        source_type,
                        duration_ms,
                        width,
                        height,
                        fps_numerator,
                        fps_denominator,
                        size_bytes,
                        checksum,
                        status,
                        _json(metadata),
                    ),
                )
                return dict(await cursor.fetchone())

    async def get(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> dict[str, Any]:
        async with self.database.connection() as connection:
            return await _owned_row(
                connection, "media_assets", media_asset_id, actor
            )

    async def update_metadata(
        self,
        actor: AuthenticatedActor,
        media_asset_id: UUID,
        metadata: dict[str, Any],
        *,
        expected_revision: int,
    ) -> dict[str, Any]:
        ensure_portable_json(metadata)
        query = """
            UPDATE media_assets
            SET metadata=%s, revision=revision+1, updated_at=now()
            WHERE id=%s AND owner_user_id=%s AND revision=%s
            RETURNING *
        """
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    query,
                    (_json(metadata), media_asset_id, actor.user_id, expected_revision),
                )
                row = await cursor.fetchone()
            if row is not None:
                return dict(row)
            current = await _owned_row(
                connection, "media_assets", media_asset_id, actor
            )
            raise PersistenceError(
                "stale_revision",
                "Media asset revision is stale",
                {
                    "entityType": "media_asset",
                    "entityId": str(media_asset_id),
                    "expectedRevision": expected_revision,
                    "actualRevision": current["revision"],
                },
            )

    async def set_storage_reference(
        self,
        actor: AuthenticatedActor,
        media_asset_id: UUID,
        *,
        storage_bucket: str,
        storage_path: str,
        expected_revision: int,
    ) -> dict[str, Any]:
        if (
            not storage_bucket.strip()
            or not storage_path.strip()
            or storage_path.startswith(("/", "\\"))
            or ".." in storage_path.replace("\\", "/").split("/")
            or (
                len(storage_path) >= 3
                and storage_path[1] == ":"
                and storage_path[2] in "\\/"
            )
        ):
            raise PersistenceError(
                "invalid_contract",
                "Storage references must be a bucket and portable object path",
                {"fieldPath": "storagePath"},
            )
        query = """
            UPDATE media_assets
            SET storage_bucket=%s, storage_path=%s, revision=revision+1,
                updated_at=now()
            WHERE id=%s AND owner_user_id=%s AND revision=%s
            RETURNING *
        """
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    query,
                    (
                        storage_bucket,
                        storage_path,
                        media_asset_id,
                        actor.user_id,
                        expected_revision,
                    ),
                )
                row = await cursor.fetchone()
            if row is None:
                current = await _owned_row(
                    connection, "media_assets", media_asset_id, actor
                )
                raise PersistenceError(
                    "stale_revision",
                    "Media asset revision is stale",
                    {
                        "entityId": str(media_asset_id),
                        "expectedRevision": expected_revision,
                        "actualRevision": current["revision"],
                    },
                )
            return dict(row)

    async def mark_deleted(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            await _owned_row(connection, "media_assets", media_asset_id, actor)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE media_assets
                    SET deleted_at=COALESCE(deleted_at,now()), status='deleted',
                        revision=revision+1, updated_at=now()
                    WHERE id=%s AND owner_user_id=%s RETURNING *
                    """,
                    (media_asset_id, actor.user_id),
                )
                return dict(await cursor.fetchone())


class TranscriptRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    async def create(
        self,
        actor: AuthenticatedActor,
        *,
        transcript_id: str,
        media_asset_id: UUID,
        document: dict[str, Any],
        status: str = "ready",
    ) -> dict[str, Any]:
        validated = validate_transcript(
            document,
            transcript_id=transcript_id,
            media_asset_id=media_asset_id,
        )
        provider = validated["provider"]
        async with self.database.transaction() as connection:
            await _owned_row(connection, "media_assets", media_asset_id, actor)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    INSERT INTO transcripts (
                      id,owner_user_id,media_asset_id,schema_version,provider_name,
                      provider_model,language_mode,duration_ms,status,document,
                      quality,metadata
                    ) VALUES (%s,%s,%s,2,%s,%s,%s,%s,%s,%s,%s,%s)
                    RETURNING *
                    """,
                    (
                        transcript_id,
                        actor.user_id,
                        media_asset_id,
                        provider["name"],
                        provider.get("model"),
                        validated["languageMode"],
                        validated["durationMs"],
                        status,
                        _json(validated),
                        _json(validated["quality"]),
                        _json(validated["metadata"]),
                    ),
                )
                return dict(await cursor.fetchone())

    async def get(
        self, actor: AuthenticatedActor, transcript_id: str
    ) -> dict[str, Any]:
        async with self.database.connection() as connection:
            return await _owned_row(
                connection, "transcripts", transcript_id, actor
            )

    async def update_document(
        self,
        actor: AuthenticatedActor,
        transcript_id: str,
        document: dict[str, Any],
        *,
        expected_revision: int,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            current = await _owned_row(
                connection, "transcripts", transcript_id, actor, for_update=True
            )
            if current["revision"] != expected_revision:
                raise PersistenceError(
                    "stale_revision",
                    "Transcript revision is stale",
                    {
                        "entityId": transcript_id,
                        "expectedRevision": expected_revision,
                        "actualRevision": current["revision"],
                    },
                )
            validated = validate_transcript(
                document,
                transcript_id=transcript_id,
                media_asset_id=current["media_asset_id"],
            )
            provider = validated["provider"]
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE transcripts SET document=%s,provider_name=%s,
                      provider_model=%s,language_mode=%s,duration_ms=%s,
                      quality=%s,metadata=%s,revision=revision+1,updated_at=now()
                    WHERE id=%s AND owner_user_id=%s AND revision=%s RETURNING *
                    """,
                    (
                        _json(validated),
                        provider["name"],
                        provider.get("model"),
                        validated["languageMode"],
                        validated["durationMs"],
                        _json(validated["quality"]),
                        _json(validated["metadata"]),
                        transcript_id,
                        actor.user_id,
                        expected_revision,
                    ),
                )
                return dict(await cursor.fetchone())

    async def list_for_media(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> list[dict[str, Any]]:
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    SELECT * FROM transcripts
                    WHERE owner_user_id=%s AND media_asset_id=%s
                    ORDER BY created_at,id
                    """,
                    (actor.user_id, media_asset_id),
                )
                return [dict(row) for row in await cursor.fetchall()]


class ClipProjectRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    async def create(
        self,
        actor: AuthenticatedActor,
        *,
        project_id: str,
        source_media_asset_id: UUID,
        project: dict[str, Any],
        transcript_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        validated = validate_clip_project(
            project,
            project_id=project_id,
            media_asset_id=source_media_asset_id,
            revision=1,
            transcript_id=transcript_id,
        )
        metadata = metadata or {}
        ensure_portable_json(metadata)
        async with self.database.transaction() as connection:
            await _owned_row(
                connection, "media_assets", source_media_asset_id, actor
            )
            if transcript_id is not None:
                transcript = await _owned_row(
                    connection, "transcripts", transcript_id, actor
                )
                if transcript["media_asset_id"] != source_media_asset_id:
                    raise PersistenceError(
                        "foreign_key_missing",
                        "Transcript does not belong to source media",
                        {"entityId": transcript_id},
                    )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    INSERT INTO clip_projects (
                      id,owner_user_id,source_media_asset_id,transcript_id,
                      schema_version,name,status,revision,project,metadata
                    ) VALUES (%s,%s,%s,%s,1,%s,%s,1,%s,%s) RETURNING *
                    """,
                    (
                        project_id,
                        actor.user_id,
                        source_media_asset_id,
                        transcript_id,
                        validated["name"],
                        validated["status"],
                        _json(validated),
                        _json(metadata),
                    ),
                )
                row = dict(await cursor.fetchone())
                await cursor.execute(
                    """
                    INSERT INTO clip_project_versions
                      (clip_project_id,revision,project,created_by)
                    VALUES (%s,1,%s,%s)
                    """,
                    (project_id, _json(validated), actor.user_id),
                )
                return row

    async def get(
        self, actor: AuthenticatedActor, project_id: str
    ) -> dict[str, Any]:
        async with self.database.connection() as connection:
            return await _owned_row(connection, "clip_projects", project_id, actor)

    async def update_with_expected_revision(
        self,
        actor: AuthenticatedActor,
        project_id: str,
        project: dict[str, Any],
        *,
        expected_revision: int,
        change_summary: str | None = None,
    ) -> dict[str, Any]:
        new_revision = expected_revision + 1
        async with self.database.transaction() as connection:
            current = await _owned_row(
                connection, "clip_projects", project_id, actor, for_update=True
            )
            if current["revision"] != expected_revision:
                raise PersistenceError(
                    "stale_revision",
                    "Clip project revision is stale",
                    {
                        "entityId": project_id,
                        "expectedRevision": expected_revision,
                        "actualRevision": current["revision"],
                    },
                )
            validated = validate_clip_project(
                project,
                project_id=project_id,
                media_asset_id=current["source_media_asset_id"],
                revision=new_revision,
                transcript_id=current["transcript_id"],
            )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE clip_projects
                    SET name=%s,status=%s,project=%s,revision=%s,updated_at=now()
                    WHERE id=%s AND owner_user_id=%s AND revision=%s RETURNING *
                    """,
                    (
                        validated["name"],
                        validated["status"],
                        _json(validated),
                        new_revision,
                        project_id,
                        actor.user_id,
                        expected_revision,
                    ),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise PersistenceError(
                        "stale_revision",
                        "Clip project changed during update",
                        {"entityId": project_id},
                    )
                await cursor.execute(
                    """
                    INSERT INTO clip_project_versions
                      (clip_project_id,revision,project,created_by,change_summary)
                    VALUES (%s,%s,%s,%s,%s)
                    """,
                    (
                        project_id,
                        new_revision,
                        _json(validated),
                        actor.user_id,
                        change_summary,
                    ),
                )
                return dict(row)

    async def _lifecycle_update(
        self,
        actor: AuthenticatedActor,
        project_id: str,
        *,
        status: str | None = None,
        archived: bool = False,
        deleted: bool = False,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            current = await _owned_row(
                connection, "clip_projects", project_id, actor, for_update=True
            )
            document = deepcopy(current["project"])
            document["revision"] = current["revision"] + 1
            document["updatedAt"] = datetime.now(timezone.utc).isoformat()
            if status is not None:
                document["status"] = status
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE clip_projects SET status=%s,project=%s,
                      revision=revision+1,updated_at=now(),
                      archived_at=CASE WHEN %s THEN COALESCE(archived_at,now()) ELSE archived_at END,
                      deleted_at=CASE WHEN %s THEN COALESCE(deleted_at,now()) ELSE deleted_at END
                    WHERE id=%s AND owner_user_id=%s RETURNING *
                    """,
                    (
                        document["status"],
                        _json(document),
                        archived,
                        deleted,
                        project_id,
                        actor.user_id,
                    ),
                )
                row = dict(await cursor.fetchone())
                await cursor.execute(
                    """
                    INSERT INTO clip_project_versions
                      (clip_project_id,revision,project,created_by,change_summary)
                    VALUES (%s,%s,%s,%s,%s)
                    """,
                    (
                        project_id,
                        row["revision"],
                        _json(document),
                        actor.user_id,
                        "archived" if archived else "deleted",
                    ),
                )
                return row

    async def archive(
        self, actor: AuthenticatedActor, project_id: str
    ) -> dict[str, Any]:
        return await self._lifecycle_update(
            actor, project_id, status="archived", archived=True
        )

    async def mark_deleted(
        self, actor: AuthenticatedActor, project_id: str
    ) -> dict[str, Any]:
        return await self._lifecycle_update(actor, project_id, deleted=True)

    async def set_derived_cache(
        self,
        actor: AuthenticatedActor,
        project_id: str,
        *,
        expected_revision: int,
        edl: dict[str, Any] | None = None,
        remapped_transcript: dict[str, Any] | None = None,
        conversion_result: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            current = await _owned_row(
                connection, "clip_projects", project_id, actor, for_update=True
            )
            if current["revision"] != expected_revision:
                raise PersistenceError(
                    "stale_revision",
                    "Clip project revision is stale",
                    {
                        "entityId": project_id,
                        "expectedRevision": expected_revision,
                        "actualRevision": current["revision"],
                    },
                )
            edl, remapped_transcript, conversion_result = validate_derived_caches(
                project_id=project_id,
                revision=expected_revision,
                media_asset_id=current["source_media_asset_id"],
                transcript_id=current["transcript_id"],
                edl=edl,
                remapped_transcript=remapped_transcript,
                conversion_result=conversion_result,
            )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE clip_projects SET latest_edl=%s,
                      latest_remapped_transcript=%s,latest_conversion_result=%s,
                      updated_at=now()
                    WHERE id=%s AND owner_user_id=%s AND revision=%s RETURNING *
                    """,
                    (
                        _json(edl) if edl is not None else None,
                        _json(remapped_transcript)
                        if remapped_transcript is not None
                        else None,
                        _json(conversion_result)
                        if conversion_result is not None
                        else None,
                        project_id,
                        actor.user_id,
                        expected_revision,
                    ),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise PersistenceError(
                        "stale_revision",
                        "Clip project changed during cache update",
                        {"entityId": project_id},
                    )
                return dict(row)


class ProcessingJobRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    @staticmethod
    def _validated_input(job_type: str, value: dict[str, Any]) -> dict[str, Any]:
        try:
            validated = validate_job_input(value)
        except ValidationError as exc:
            raise PersistenceError(
                "invalid_contract",
                "Invalid processing job input",
                {"fieldPath": ".".join(str(x) for x in exc.errors()[0]["loc"])},
            ) from exc
        if validated["jobType"] != job_type:
            raise PersistenceError(
                "invalid_contract",
                "Job type does not match input envelope",
                {"fieldPath": "jobType"},
            )
        return validated

    async def _insert(
        self,
        connection: Any,
        actor: AuthenticatedActor,
        *,
        job_type: str,
        input: dict[str, Any],
        job_id: UUID,
        project_id: str | None,
        media_asset_id: UUID | None,
        priority: int,
        max_attempts: int,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        validated = self._validated_input(job_type, input)
        input_media_id = validated.get("mediaAssetId")
        input_project_id = validated.get("clipProjectId")
        if input_media_id is not None and str(input_media_id) != str(media_asset_id):
            raise PersistenceError(
                "invalid_contract",
                "Job input media reference does not match the row",
                {"fieldPath": "mediaAssetId"},
            )
        if input_project_id is not None and input_project_id != project_id:
            raise PersistenceError(
                "invalid_contract",
                "Job input project reference does not match the row",
                {"fieldPath": "clipProjectId"},
            )
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                INSERT INTO processing_jobs (
                  id,owner_user_id,project_id,media_asset_id,job_type,status,
                  priority,input,max_attempts,idempotency_key
                ) VALUES (%s,%s,%s,%s,%s,'queued',%s,%s,%s,%s) RETURNING *
                """,
                (
                    job_id,
                    actor.user_id,
                    project_id,
                    media_asset_id,
                    job_type,
                    priority,
                    _json(validated),
                    max_attempts,
                    idempotency_key,
                ),
            )
            return dict(await cursor.fetchone())

    async def create(
        self,
        actor: AuthenticatedActor,
        *,
        job_type: str,
        input: dict[str, Any],
        job_id: UUID | None = None,
        project_id: str | None = None,
        media_asset_id: UUID | None = None,
        priority: int = 0,
        max_attempts: int = 3,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            return await self._insert(
                connection,
                actor,
                job_type=job_type,
                input=input,
                job_id=job_id or uuid4(),
                project_id=project_id,
                media_asset_id=media_asset_id,
                priority=priority,
                max_attempts=max_attempts,
                idempotency_key=idempotency_key,
            )

    async def create_idempotent(
        self,
        actor: AuthenticatedActor,
        idempotency: "IdempotencyRepository",
        *,
        scope: str,
        idempotency_key: str,
        request_hash: str,
        job_type: str,
        input: dict[str, Any],
        project_id: str | None = None,
        media_asset_id: UUID | None = None,
    ) -> tuple[dict[str, Any], bool]:
        async with self.database.transaction() as connection:
            record, created = await idempotency._begin(
                connection,
                actor,
                scope=scope,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if not created:
                if record["status"] == "completed" and record["resource_id"]:
                    job = await _owned_row(
                        connection,
                        "processing_jobs",
                        UUID(record["resource_id"]),
                        actor,
                    )
                    return job, True
                raise PersistenceError(
                    "idempotency_in_progress",
                    "An equivalent request is already in progress",
                    {"scope": scope, "idempotencyKey": idempotency_key},
                )
            job = await self._insert(
                connection,
                actor,
                job_type=job_type,
                input=input,
                job_id=uuid4(),
                project_id=project_id,
                media_asset_id=media_asset_id,
                priority=0,
                max_attempts=3,
                idempotency_key=idempotency_key,
            )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE idempotency_records SET status='completed',
                      response_code=202,response=%s,resource_type='processing_job',
                      resource_id=%s,updated_at=now() WHERE id=%s RETURNING *
                    """,
                    (_json({"jobId": str(job["id"])}), str(job["id"]), record["id"]),
                )
            return job, False

    async def get(
        self, actor: AuthenticatedActor, job_id: UUID
    ) -> dict[str, Any]:
        async with self.database.connection() as connection:
            return await _owned_row(connection, "processing_jobs", job_id, actor)

    async def list_for_owner(
        self, actor: AuthenticatedActor, *, limit: int = 50
    ) -> list[dict[str, Any]]:
        limit = min(max(limit, 1), 200)
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    SELECT * FROM processing_jobs WHERE owner_user_id=%s
                    ORDER BY created_at DESC,id DESC LIMIT %s
                    """,
                    (actor.user_id, limit),
                )
                return [dict(row) for row in await cursor.fetchall()]

    async def transition(
        self,
        actor: AuthenticatedActor,
        job_id: UUID,
        requested_status: str,
        *,
        expected_revision: int,
        output: dict[str, Any] | None = None,
        error: dict[str, Any] | None = None,
        worker_id: str | None = None,
        available_at: datetime | None = None,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            current = await _owned_row(
                connection, "processing_jobs", job_id, actor, for_update=True
            )
            if current["revision"] != expected_revision:
                raise PersistenceError(
                    "stale_revision",
                    "Processing job revision is stale",
                    {
                        "entityId": str(job_id),
                        "expectedRevision": expected_revision,
                        "actualRevision": current["revision"],
                    },
                )
            if requested_status not in ALLOWED_JOB_TRANSITIONS[current["status"]]:
                raise PersistenceError(
                    "invalid_job_transition",
                    "Processing job transition is not allowed",
                    {
                        "entityId": str(job_id),
                        "currentState": current["status"],
                        "requestedState": requested_status,
                    },
                )
            progress = Decimal("100") if requested_status == "succeeded" else current["progress"]
            started = requested_status == "running"
            finished = requested_status in TERMINAL_JOB_STATUSES
            cancelled = requested_status == "cancelled"
            attempt_increment = 1 if requested_status == "running" else 0
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE processing_jobs SET status=%s,progress=%s,output=%s,
                      error=%s,worker_id=COALESCE(%s,worker_id),
                      attempt_count=attempt_count+%s,
                      started_at=CASE WHEN %s THEN COALESCE(started_at,now()) ELSE started_at END,
                      finished_at=CASE WHEN %s THEN now() ELSE finished_at END,
                      cancel_requested_at=CASE WHEN %s THEN now() ELSE cancel_requested_at END,
                      cancelled_at=CASE WHEN %s THEN now() ELSE cancelled_at END,
                      available_at=COALESCE(%s,available_at),
                      revision=revision+1,updated_at=now()
                    WHERE id=%s AND owner_user_id=%s AND revision=%s RETURNING *
                    """,
                    (
                        requested_status,
                        progress,
                        _json(output) if output is not None else None,
                        _json(error) if error is not None else None,
                        worker_id,
                        attempt_increment,
                        started,
                        finished,
                        requested_status == "cancel_requested",
                        cancelled,
                        available_at,
                        job_id,
                        actor.user_id,
                        expected_revision,
                    ),
                )
                return dict(await cursor.fetchone())

    async def update_progress(
        self,
        actor: AuthenticatedActor,
        job_id: UUID,
        progress: float,
        *,
        expected_revision: int,
        current_stage: str | None = None,
    ) -> dict[str, Any]:
        if not 0 <= progress <= 100:
            raise PersistenceError(
                "invalid_job_progress",
                "Job progress must be between 0 and 100",
                {"entityId": str(job_id)},
            )
        async with self.database.transaction() as connection:
            current = await _owned_row(
                connection, "processing_jobs", job_id, actor, for_update=True
            )
            if current["status"] in TERMINAL_JOB_STATUSES:
                raise PersistenceError(
                    "invalid_job_transition",
                    "Terminal job progress cannot be changed",
                    {"currentState": current["status"]},
                )
            if current["revision"] != expected_revision:
                raise PersistenceError(
                    "stale_revision",
                    "Processing job revision is stale",
                    {"actualRevision": current["revision"]},
                )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE processing_jobs SET progress=%s,current_stage=%s,
                      revision=revision+1,updated_at=now()
                    WHERE id=%s AND owner_user_id=%s AND revision=%s RETURNING *
                    """,
                    (
                        progress,
                        current_stage,
                        job_id,
                        actor.user_id,
                        expected_revision,
                    ),
                )
                return dict(await cursor.fetchone())

    async def request_cancel(
        self,
        actor: AuthenticatedActor,
        job_id: UUID,
        *,
        expected_revision: int,
    ) -> dict[str, Any]:
        return await self.transition(
            actor,
            job_id,
            "cancel_requested",
            expected_revision=expected_revision,
        )

    async def record_heartbeat(
        self,
        actor: AuthenticatedActor,
        job_id: UUID,
        *,
        expected_revision: int,
        worker_id: str,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            current = await _owned_row(
                connection, "processing_jobs", job_id, actor, for_update=True
            )
            if current["revision"] != expected_revision:
                raise PersistenceError(
                    "stale_revision", "Processing job revision is stale"
                )
            if current["status"] not in {"claimed", "running", "cancel_requested"}:
                raise PersistenceError(
                    "invalid_job_transition",
                    "Heartbeat is not valid for the current state",
                    {"currentState": current["status"]},
                )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE processing_jobs SET heartbeat_at=now(),worker_id=%s,
                      revision=revision+1,updated_at=now()
                    WHERE id=%s AND owner_user_id=%s AND revision=%s RETURNING *
                    """,
                    (worker_id, job_id, actor.user_id, expected_revision),
                )
                return dict(await cursor.fetchone())

    async def schedule_retry(
        self,
        actor: AuthenticatedActor,
        job_id: UUID,
        *,
        expected_revision: int,
        available_at: datetime,
        error: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await self.transition(
            actor,
            job_id,
            "retry_wait",
            expected_revision=expected_revision,
            error=error,
            available_at=available_at,
        )


class IdempotencyRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    async def _begin(
        self,
        connection: Any,
        actor: AuthenticatedActor,
        *,
        scope: str,
        idempotency_key: str,
        request_hash: str,
        expires_at: datetime | None = None,
    ) -> tuple[dict[str, Any], bool]:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                INSERT INTO idempotency_records (
                  owner_user_id,scope,idempotency_key,request_hash,expires_at
                ) VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (scope,idempotency_key) DO NOTHING RETURNING *
                """,
                (
                    actor.user_id,
                    scope,
                    idempotency_key,
                    request_hash,
                    expires_at,
                ),
            )
            row = await cursor.fetchone()
            if row is not None:
                return dict(row), True
            await cursor.execute(
                """
                SELECT * FROM idempotency_records
                WHERE scope=%s AND idempotency_key=%s FOR UPDATE
                """,
                (scope, idempotency_key),
            )
            existing = dict(await cursor.fetchone())
            if existing["owner_user_id"] != actor.user_id:
                raise PersistenceError(
                    "idempotency_conflict",
                    "Idempotency scope is owned by another actor",
                    {"scope": scope, "idempotencyKey": idempotency_key},
                )
            if existing["request_hash"] != request_hash:
                raise PersistenceError(
                    "idempotency_conflict",
                    "Idempotency key was reused for a different request",
                    {"scope": scope, "idempotencyKey": idempotency_key},
                )
            if (
                existing["status"] == "expired"
                or (
                    existing["expires_at"] is not None
                    and existing["expires_at"] <= datetime.now(timezone.utc)
                )
            ):
                await cursor.execute(
                    """
                    UPDATE idempotency_records SET status='in_progress',
                      response_code=NULL,response=NULL,resource_type=NULL,
                      resource_id=NULL,expires_at=%s,updated_at=now()
                    WHERE id=%s RETURNING *
                    """,
                    (expires_at, existing["id"]),
                )
                return dict(await cursor.fetchone()), True
            return existing, False

    async def begin(
        self,
        actor: AuthenticatedActor,
        *,
        scope: str,
        idempotency_key: str,
        request_hash: str,
        expires_at: datetime | None = None,
    ) -> tuple[dict[str, Any], bool]:
        async with self.database.transaction() as connection:
            record, created = await self._begin(
                connection,
                actor,
                scope=scope,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                expires_at=expires_at,
            )
            if not created and record["status"] == "in_progress":
                raise PersistenceError(
                    "idempotency_in_progress",
                    "An equivalent request is already in progress",
                    {"scope": scope, "idempotencyKey": idempotency_key},
                )
            return record, created

    async def get(
        self,
        actor: AuthenticatedActor,
        *,
        scope: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    SELECT * FROM idempotency_records
                    WHERE owner_user_id=%s AND scope=%s AND idempotency_key=%s
                    """,
                    (actor.user_id, scope, idempotency_key),
                )
                row = await cursor.fetchone()
        if row is None:
            raise _not_found("idempotency_record", f"{scope}:{idempotency_key}")
        return dict(row)

    async def _finish(
        self,
        actor: AuthenticatedActor,
        *,
        scope: str,
        idempotency_key: str,
        status: str,
        response_code: int | None = None,
        response: dict[str, Any] | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE idempotency_records SET status=%s,response_code=%s,
                      response=%s,resource_type=%s,resource_id=%s,updated_at=now()
                    WHERE owner_user_id=%s AND scope=%s AND idempotency_key=%s
                    RETURNING *
                    """,
                    (
                        status,
                        response_code,
                        _json(response) if response is not None else None,
                        resource_type,
                        resource_id,
                        actor.user_id,
                        scope,
                        idempotency_key,
                    ),
                )
                row = await cursor.fetchone()
            if row is None:
                raise _not_found(
                    "idempotency_record", f"{scope}:{idempotency_key}"
                )
            return dict(row)

    async def complete(
        self,
        actor: AuthenticatedActor,
        *,
        scope: str,
        idempotency_key: str,
        response_code: int,
        response: dict[str, Any],
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._finish(
            actor,
            scope=scope,
            idempotency_key=idempotency_key,
            status="completed",
            response_code=response_code,
            response=response,
            resource_type=resource_type,
            resource_id=resource_id,
        )

    async def mark_failed(
        self,
        actor: AuthenticatedActor,
        *,
        scope: str,
        idempotency_key: str,
        response_code: int,
        response: dict[str, Any],
    ) -> dict[str, Any]:
        return await self._finish(
            actor,
            scope=scope,
            idempotency_key=idempotency_key,
            status="failed",
            response_code=response_code,
            response=response,
        )

    async def expire(
        self,
        actor: AuthenticatedActor,
        *,
        scope: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        return await self._finish(
            actor,
            scope=scope,
            idempotency_key=idempotency_key,
            status="expired",
        )
