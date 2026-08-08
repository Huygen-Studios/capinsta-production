from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from pydantic import ValidationError

from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.models import AuthenticatedActor
from server.clipping_persistence.validation import ensure_portable_json

try:
    from contracts.clip_project_v1 import ClipProjectV1
except ImportError:
    from backend.contracts.clip_project_v1 import ClipProjectV1

from .contracts import (
    ConversionRequest,
    CreateProjectRequest,
    DeriveRequest,
    DraftRequest,
    ProjectConversionRequestJobInputV1,
    ProjectDerivationJobInputV1,
    RecommendationDecisionRequest,
    UpdateProjectRequest,
)
from .drafts import AcceptedRecommendationDraftService
from .errors import OrchestrationError
from .identity import canonical_hash, stable_id

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


class ClippingOrchestrationRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database
        self.drafts = AcceptedRecommendationDraftService()

    @staticmethod
    async def _project(connection, actor, project_id, *, lock=False, include_deleted=False):
        suffix = " FOR UPDATE" if lock else ""
        deleted = "" if include_deleted else " AND deleted_at IS NULL"
        async with connection.cursor() as cursor:
            await cursor.execute(
                f"""SELECT * FROM clip_projects
                WHERE id=%s AND owner_user_id=%s{deleted}{suffix}""",
                (project_id, actor.user_id),
            )
            row = await cursor.fetchone()
        if row is None:
            raise OrchestrationError("project_not_found", "Project was not found", 404)
        return dict(row)

    @staticmethod
    async def _reserve(
        connection,
        actor: AuthenticatedActor,
        *,
        operation: str,
        key: str,
        request: dict[str, Any],
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        scope = f"{actor.user_id}:clipping:{operation}"
        request_hash = canonical_hash(request)
        async with connection.cursor() as cursor:
            await cursor.execute(
                """INSERT INTO idempotency_records(
                owner_user_id,scope,idempotency_key,request_hash
                ) VALUES (%s,%s,%s,%s)
                ON CONFLICT(scope,idempotency_key) DO NOTHING RETURNING *""",
                (actor.user_id, scope, key, request_hash),
            )
            row = await cursor.fetchone()
            if row is not None:
                return dict(row), None
            await cursor.execute(
                """SELECT * FROM idempotency_records
                WHERE scope=%s AND idempotency_key=%s FOR UPDATE""",
                (scope, key),
            )
            existing = dict(await cursor.fetchone())
        if existing["owner_user_id"] != actor.user_id or existing["request_hash"] != request_hash:
            raise OrchestrationError(
                "idempotency_conflict",
                "Idempotency key was used with a different request",
                409,
            )
        if existing["status"] == "completed" and isinstance(existing["response"], dict):
            return existing, existing["response"]
        raise OrchestrationError(
            "idempotency_in_progress", "Equivalent request is already in progress", 409
        )

    @staticmethod
    async def _complete(connection, record, response, *, code=200, resource_type=None, resource_id=None):
        async with connection.cursor() as cursor:
            await cursor.execute(
                """UPDATE idempotency_records SET status='completed',
                response_code=%s,response=%s,resource_type=%s,resource_id=%s,
                updated_at=now() WHERE id=%s""",
                (code, _json(response), resource_type, resource_id, record["id"]),
            )

    @staticmethod
    def _safe_project_response(row: dict[str, Any]) -> dict[str, Any]:
        def timestamp(value):
            return value.isoformat() if hasattr(value, "isoformat") else value
        return {
            "project": row["project"],
            "revision": row["revision"],
            "createdAt": timestamp(row["created_at"]),
            "updatedAt": timestamp(row["updated_at"]),
            "archivedAt": timestamp(row["archived_at"]),
        }

    @staticmethod
    async def _assert_dependencies_current(connection, project: dict[str, Any]) -> None:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """SELECT revision,status,deleted_at FROM media_assets
                WHERE id=%s AND owner_user_id=%s""",
                (project["source_media_asset_id"], project["owner_user_id"]),
            )
            media = await cursor.fetchone()
            await cursor.execute(
                """SELECT revision,status,deleted_at FROM transcripts
                WHERE id=%s AND owner_user_id=%s""",
                (project["transcript_id"], project["owner_user_id"]),
            )
            transcript = await cursor.fetchone()
        if (
            media is None
            or media["deleted_at"] is not None
            or media["status"] != "ready"
            or media["revision"] != project["media_revision"]
        ):
            raise OrchestrationError(
                "media_revision_stale", "Project media dependency is no longer current", 409
            )
        if (
            transcript is None
            or transcript["deleted_at"] is not None
            or transcript["status"] != "ready"
            or transcript["revision"] != project["transcript_revision"]
        ):
            raise OrchestrationError(
                "transcript_revision_stale",
                "Project transcript dependency is no longer current",
                409,
            )

    async def create_project(
        self,
        actor: AuthenticatedActor,
        request: CreateProjectRequest,
        *,
        idempotency_key: str,
        maximum_ranges: int,
    ) -> dict[str, Any]:
        payload = request.model_dump(mode="json")
        ensure_portable_json(payload)
        if request.initialRanges is not None and len(request.initialRanges) > maximum_ranges:
            raise OrchestrationError("draft_range_invalid", "Too many initial ranges", 422)
        async with self.database.transaction() as connection:
            record, replay = await self._reserve(
                connection, actor, operation="create", key=idempotency_key, request=payload
            )
            if replay is not None:
                return replay
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT * FROM media_assets WHERE id=%s AND owner_user_id=%s
                    AND deleted_at IS NULL FOR UPDATE""",
                    (request.mediaAssetId, actor.user_id),
                )
                asset_row = await cursor.fetchone()
                if asset_row is None:
                    raise OrchestrationError("project_not_found", "Source media was not found", 404)
                asset = dict(asset_row)
                if asset["status"] != "ready" or asset["duration_ms"] is None or asset["duration_ms"] <= 0:
                    raise OrchestrationError("media_not_ready", "Source media is not ready", 409)
                await cursor.execute(
                    """SELECT * FROM transcripts WHERE id=%s AND owner_user_id=%s
                    AND deleted_at IS NULL FOR UPDATE""",
                    (request.transcriptId, actor.user_id),
                )
                transcript_row = await cursor.fetchone()
            if transcript_row is None:
                raise OrchestrationError("project_not_found", "Transcript was not found", 404)
            transcript = dict(transcript_row)
            if transcript["media_asset_id"] != asset["id"]:
                raise OrchestrationError(
                    "transcript_project_mismatch", "Transcript does not match source media", 409
                )
            if transcript["status"] != "ready":
                raise OrchestrationError("transcript_not_ready", "Transcript is not ready", 409)
            project_id = stable_id(
                "clip", {"owner": str(actor.user_id), "idempotency": idempotency_key}
            )
            now = datetime.now(timezone.utc)
            ranges = deepcopy(request.initialRanges)
            if ranges is None:
                ranges = [
                    {
                        "schemaVersion": 1,
                        "id": stable_id("range", {"projectId": project_id, "kind": "full_source"}),
                        "sourceMediaId": str(asset["id"]),
                        "sourceStartMs": 0,
                        "sourceEndMs": asset["duration_ms"],
                        "order": 0,
                        "playbackRate": 1,
                        "selection": None,
                        "boundary": {
                            "preRollMs": 0,
                            "postRollMs": 0,
                            "startAdjustedManually": False,
                            "endAdjustedManually": False,
                        },
                        "transitionIn": None,
                        "transitionOut": None,
                        "enabled": True,
                        "label": None,
                        "metadata": {"base": "full_source"},
                    }
                ]
            try:
                project = ClipProjectV1.model_validate(
                    {
                    "schemaVersion": 1,
                    "clipProjectId": project_id,
                    "workspaceId": None,
                    "name": request.name,
                    "sourceMedia": {
                        "mediaId": str(asset["id"]),
                        "durationMs": asset["duration_ms"],
                        "sourceType": asset["source_type"],
                        "displayName": asset["display_name"],
                        "mimeType": asset["mime_type"],
                        "storageKey": None,
                        "checksum": asset["checksum"],
                        "metadata": {},
                    },
                    "transcriptId": transcript["id"],
                    "transcriptRevision": transcript["revision"],
                    "ranges": ranges,
                    "canvas": request.canvas.model_dump(mode="json"),
                    "captionTrack": None,
                    "settings": {},
                    "status": "draft",
                    "revision": 1,
                    "metadata": request.metadata,
                    "createdAt": now,
                    "updatedAt": now,
                    }
                ).model_dump(mode="json")
            except ValidationError as exc:
                raise OrchestrationError(
                    "draft_result_invalid", "Initial project is invalid", 422
                ) from exc
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """INSERT INTO clip_projects(
                    id,owner_user_id,source_media_asset_id,transcript_id,schema_version,
                    name,status,revision,project,metadata,media_revision,transcript_revision
                    ) VALUES (%s,%s,%s,%s,1,%s,'draft',1,%s,%s,%s,%s) RETURNING *""",
                    (
                        project_id, actor.user_id, asset["id"], transcript["id"], request.name,
                        _json(project), _json(request.metadata), asset["revision"], transcript["revision"],
                    ),
                )
                row = dict(await cursor.fetchone())
                await cursor.execute(
                    """INSERT INTO clip_project_versions(
                    clip_project_id,revision,project,created_by,change_summary,
                    version_source,transcript_revision
                    ) VALUES (%s,1,%s,%s,'Project created','manual',%s)""",
                    (project_id, _json(project), actor.user_id, transcript["revision"]),
                )
            response = self._safe_project_response(row)
            await self._complete(
                connection, record, response, code=201,
                resource_type="clip_project", resource_id=project_id,
            )
            return response

    async def get_detail(self, actor: AuthenticatedActor, project_id: str) -> dict[str, Any]:
        async with self.database.connection() as connection:
            project = await self._project(connection, actor, project_id)
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT id,status,duration_ms,revision FROM media_assets WHERE id=%s", (project["source_media_asset_id"],))
                media = dict(await cursor.fetchone())
                await cursor.execute("SELECT id,status,revision FROM transcripts WHERE id=%s", (project["transcript_id"],))
                transcript = dict(await cursor.fetchone())
                await cursor.execute(
                    """SELECT analysis_type,status,count(*) AS count FROM transcript_analyses
                    WHERE transcript_id=%s AND transcript_revision=%s AND deleted_at IS NULL
                    GROUP BY analysis_type,status""",
                    (project["transcript_id"], project["transcript_revision"]),
                )
                analyses = [dict(row) for row in await cursor.fetchall()]
                await cursor.execute(
                    """SELECT r.status,count(*) AS count FROM timeline_recommendations r
                    JOIN transcript_analyses a ON a.id=r.analysis_id
                    WHERE r.transcript_id=%s AND a.transcript_revision=%s
                    AND a.media_revision=%s GROUP BY r.status""",
                    (
                        project["transcript_id"],
                        project["transcript_revision"],
                        project["media_revision"],
                    ),
                )
                recommendations = {row["status"]: row["count"] for row in await cursor.fetchall()}
        current = project["revision"]
        return {
            **self._safe_project_response(project),
            "media": {"id": str(media["id"]), "status": media["status"], "durationMs": media["duration_ms"]},
            "transcript": transcript,
            "derived": {
                "edlStatus": "current" if project["latest_edl_revision"] == current and project["latest_derivation_result_identity"] else ("stale" if project["latest_edl"] else "missing"),
                "remappedTranscriptStatus": "current" if project["latest_remapped_transcript_revision"] == current and project["latest_derivation_result_identity"] else ("stale" if project["latest_remapped_transcript"] else "missing"),
                "conversionStatus": "current" if project["latest_conversion_revision"] == current and project["latest_conversion_result_identity"] else ("stale" if project["latest_conversion_result"] else "missing"),
            },
            "analysisSummary": analyses,
            "recommendationSummary": {
                key: recommendations.get(key, 0)
                for key in ("proposed", "accepted", "rejected", "superseded")
            },
        }

    async def list_projects(
        self, actor, *, limit, cursor_created_at=None, cursor_id=None, archived=None,
        status=None,
    ):
        clauses = ["owner_user_id=%s", "deleted_at IS NULL"]
        values: list[Any] = [actor.user_id]
        if archived is True:
            clauses.append("archived_at IS NOT NULL")
        elif archived is False:
            clauses.append("archived_at IS NULL")
        if status is not None:
            clauses.append("status=%s")
            values.append(status)
        if cursor_created_at and cursor_id:
            clauses.append("(created_at,id)<(%s,%s)")
            values.extend([cursor_created_at, cursor_id])
        values.append(limit + 1)
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    f"""SELECT id,name,status,revision,source_media_asset_id,
                    transcript_id,updated_at,created_at,archived_at
                    FROM clip_projects WHERE {' AND '.join(clauses)}
                    ORDER BY created_at DESC,id DESC LIMIT %s""",
                    values,
                )
                return [dict(row) for row in await cursor.fetchall()]

    async def update_project(self, actor, project_id, request: UpdateProjectRequest, *, idempotency_key, maximum_ranges):
        payload = request.model_dump(mode="json")
        ensure_portable_json(payload)
        if request.ranges is not None and len(request.ranges) > maximum_ranges:
            raise OrchestrationError("draft_range_invalid", "Too many project ranges", 422)
        async with self.database.transaction() as connection:
            record, replay = await self._reserve(
                connection, actor, operation=f"update:{project_id}", key=idempotency_key, request=payload
            )
            if replay is not None:
                return replay
            current = await self._project(connection, actor, project_id, lock=True)
            await self._assert_dependencies_current(connection, current)
            if current["archived_at"] is not None:
                raise OrchestrationError("project_archived", "Archived project cannot be updated", 409)
            if current["revision"] != request.expectedRevision:
                raise OrchestrationError("project_revision_conflict", "Project revision is stale", 409)
            value = deepcopy(current["project"])
            value["revision"] = current["revision"] + 1
            value["updatedAt"] = datetime.now(timezone.utc).isoformat()
            if request.name is not None:
                value["name"] = request.name
            if request.canvas is not None:
                value["canvas"] = request.canvas.model_dump(mode="json")
            if request.ranges is not None:
                value["ranges"] = request.ranges
            if request.metadata is not None:
                value["metadata"] = request.metadata
            try:
                project = ClipProjectV1.model_validate(value).model_dump(mode="json")
            except ValidationError as exc:
                raise OrchestrationError("draft_result_invalid", "Project update is invalid", 422) from exc
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clip_projects SET name=%s,status=%s,project=%s,
                    metadata=%s,revision=revision+1,latest_edl=NULL,
                    latest_remapped_transcript=NULL,latest_conversion_result=NULL,
                    latest_edl_revision=NULL,latest_remapped_transcript_revision=NULL,
                    latest_conversion_revision=NULL,
                    latest_derivation_transcript_revision=NULL,
                    latest_derivation_result_identity=NULL,
                    latest_conversion_result_identity=NULL,updated_at=now()
                    WHERE id=%s AND owner_user_id=%s AND revision=%s RETURNING *""",
                    (
                        project["name"], project["status"], _json(project),
                        _json(project["metadata"]), project_id, actor.user_id,
                        request.expectedRevision,
                    ),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise OrchestrationError("project_revision_conflict", "Project revision is stale", 409)
                row = dict(row)
                await cursor.execute(
                    """INSERT INTO clip_project_versions(
                    clip_project_id,revision,project,created_by,change_summary,
                    version_source,transcript_revision
                    ) VALUES (%s,%s,%s,%s,'Manual project update','manual',%s)""",
                    (project_id, row["revision"], _json(project), actor.user_id, row["transcript_revision"]),
                )
            response = self._safe_project_response(row)
            await self._complete(connection, record, response, resource_type="clip_project", resource_id=project_id)
            return response

    async def lifecycle(self, actor, project_id, *, delete, idempotency_key):
        request = {"projectId": project_id, "operation": "delete" if delete else "archive"}
        async with self.database.transaction() as connection:
            record, replay = await self._reserve(
                connection, actor, operation=request["operation"], key=idempotency_key, request=request
            )
            if replay is not None:
                return replay
            current = await self._project(connection, actor, project_id, lock=True, include_deleted=True)
            already = current["deleted_at"] is not None if delete else current["archived_at"] is not None
            if already:
                response = self._safe_project_response(current)
                await self._complete(connection, record, response, resource_type="clip_project", resource_id=project_id)
                return response
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT 1 FROM processing_jobs WHERE project_id=%s
                    AND owner_user_id=%s AND status IN ('queued','running','cancel_requested')
                    LIMIT 1""",
                    (project_id, actor.user_id),
                )
                if await cursor.fetchone() is not None:
                    raise OrchestrationError(
                        "project_processing_active",
                        "Project cannot be archived or deleted while processing is active",
                        409,
                    )
            value = deepcopy(current["project"])
            value["revision"] = current["revision"] + 1
            value["updatedAt"] = datetime.now(timezone.utc).isoformat()
            if not delete:
                value["status"] = "archived"
            async with connection.cursor() as cursor:
                await cursor.execute(
                    f"""UPDATE clip_projects SET project=%s,status=%s,revision=revision+1,
                    {'deleted_at=now(),' if delete else 'archived_at=now(),'}
                    updated_at=now() WHERE id=%s AND owner_user_id=%s RETURNING *""",
                    (_json(value), value["status"], project_id, actor.user_id),
                )
                row = dict(await cursor.fetchone())
                await cursor.execute(
                    """INSERT INTO clip_project_versions(
                    clip_project_id,revision,project,created_by,change_summary,
                    version_source,transcript_revision
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        project_id, row["revision"], _json(value), actor.user_id,
                        "Project deleted" if delete else "Project archived",
                        "delete" if delete else "archive", row["transcript_revision"],
                    ),
                )
            response = self._safe_project_response(row)
            await self._complete(connection, record, response, resource_type="clip_project", resource_id=project_id)
            return response

    async def list_versions(self, actor, project_id, *, limit, cursor_created_at=None, cursor_id=None):
        async with self.database.connection() as connection:
            await self._project(connection, actor, project_id)
            clauses = ["clip_project_id=%s"]
            values: list[Any] = [project_id]
            if cursor_created_at and cursor_id:
                clauses.append("(created_at,id)<(%s,%s)")
                values.extend([cursor_created_at, UUID(cursor_id)])
            values.append(limit + 1)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    f"""SELECT id,clip_project_id,revision,created_by,change_summary,
                    version_source,transcript_revision,derivation_identity,created_at
                    FROM clip_project_versions WHERE {' AND '.join(clauses)}
                    ORDER BY created_at DESC,id DESC LIMIT %s""",
                    values,
                )
                return [dict(row) for row in await cursor.fetchall()]

    async def get_version(self, actor, project_id, revision):
        async with self.database.connection() as connection:
            await self._project(connection, actor, project_id)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT revision,project,created_by,change_summary,version_source,
                    transcript_revision,derivation_identity,created_at
                    FROM clip_project_versions WHERE clip_project_id=%s AND revision=%s""",
                    (project_id, revision),
                )
                row = await cursor.fetchone()
        if row is None:
            raise OrchestrationError("project_not_found", "Project version was not found", 404)
        return dict(row)

    async def list_recommendations(
        self, actor, project_id, *, limit, cursor_created_at=None, cursor_id=None,
        status=None, recommendation_type=None, analysis_id=None, timed=None,
    ):
        async with self.database.connection() as connection:
            project = await self._project(connection, actor, project_id)
            clauses = [
                "r.owner_user_id=%s", "r.transcript_id=%s",
                "a.transcript_revision=%s", "a.media_revision=%s",
            ]
            values: list[Any] = [
                actor.user_id, project["transcript_id"],
                project["transcript_revision"], project["media_revision"],
            ]
            for clause, value in (
                ("r.status=%s", status),
                ("r.recommendation_type=%s", recommendation_type),
                ("r.analysis_id=%s", analysis_id),
            ):
                if value is not None:
                    clauses.append(clause)
                    values.append(value)
            if timed is True:
                clauses.append("r.source_start_ms IS NOT NULL")
            elif timed is False:
                clauses.append("r.source_start_ms IS NULL")
            if cursor_created_at and cursor_id:
                clauses.append("(r.created_at,r.id)<(%s,%s)")
                values.extend([cursor_created_at, cursor_id])
            values.append(limit + 1)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    f"""SELECT r.*,a.transcript_revision,a.media_revision
                    FROM timeline_recommendations r
                    JOIN transcript_analyses a ON a.id=r.analysis_id
                    WHERE {' AND '.join(clauses)}
                    ORDER BY r.created_at DESC,r.id DESC LIMIT %s""",
                    values,
                )
                return [dict(row) for row in await cursor.fetchall()]

    async def decide(self, actor, project_id, request: RecommendationDecisionRequest, *, idempotency_key, request_id):
        payload = request.model_dump(mode="json")
        async with self.database.transaction() as connection:
            record, replay = await self._reserve(
                connection, actor, operation=f"decisions:{project_id}", key=idempotency_key, request=payload
            )
            if replay is not None:
                return replay
            project = await self._project(connection, actor, project_id, lock=True)
            await self._assert_dependencies_current(connection, project)
            if project["revision"] != request.expectedProjectRevision:
                raise OrchestrationError("project_revision_conflict", "Project revision is stale", 409)
            ids = [item.recommendationId for item in request.decisions]
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT r.*,a.status AS analysis_status,a.transcript_revision,
                    a.media_revision FROM timeline_recommendations r
                    JOIN transcript_analyses a ON a.id=r.analysis_id
                    WHERE r.id=ANY(%s) AND r.owner_user_id=%s FOR UPDATE OF r""",
                    (ids, actor.user_id),
                )
                rows = {row["id"]: dict(row) for row in await cursor.fetchall()}
            if len(rows) != len(ids):
                raise OrchestrationError("recommendation_not_found", "Recommendation was not found", 404)
            decided = []
            async with connection.cursor() as cursor:
                for decision in request.decisions:
                    row = rows[decision.recommendationId]
                    if (
                        row["transcript_id"] != project["transcript_id"]
                        or row["transcript_revision"] != project["transcript_revision"]
                        or row["media_revision"] != project["media_revision"]
                    ):
                        raise OrchestrationError("recommendation_stale", "Recommendation is stale", 409)
                    if row["analysis_status"] != "ready" or row["status"] == "superseded":
                        raise OrchestrationError("recommendation_not_actionable", "Recommendation is not actionable", 409)
                    if row["status"] in {"accepted", "rejected"}:
                        if row["status"] != decision.decision:
                            raise OrchestrationError(
                                "recommendation_decision_conflict",
                                "Recommendation already has a different decision",
                                409,
                            )
                        decided.append(row["id"])
                        continue
                    await cursor.execute(
                        """UPDATE timeline_recommendations SET status=%s,
                        decided_by=%s,decided_at=now(),decision_note=%s,
                        decision_request_id=%s,decision_project_revision=%s,
                        updated_at=now() WHERE id=%s AND status='proposed'""",
                        (
                            decision.decision, actor.user_id, request.note,
                            request_id[:200], project["revision"], row["id"],
                        ),
                    )
                    if cursor.rowcount != 1:
                        raise OrchestrationError("recommendation_decision_conflict", "Recommendation changed concurrently", 409)
                    decided.append(row["id"])
            response = {"projectId": project_id, "projectRevision": project["revision"], "decidedRecommendationIds": sorted(decided)}
            await self._complete(connection, record, response, resource_type="clip_project", resource_id=project_id)
            return response

    async def derive_draft(self, actor, project_id, request: DraftRequest, *, idempotency_key):
        payload = request.model_dump(mode="json")
        async with self.database.transaction() as connection:
            record, replay = await self._reserve(
                connection, actor, operation=f"draft:{project_id}", key=idempotency_key, request=payload
            )
            if replay is not None:
                return replay
            project_row = await self._project(connection, actor, project_id, lock=True)
            await self._assert_dependencies_current(connection, project_row)
            if project_row["archived_at"] is not None:
                raise OrchestrationError("project_archived", "Archived project cannot receive drafts", 409)
            if project_row["revision"] != request.expectedProjectRevision:
                raise OrchestrationError("project_revision_conflict", "Project revision is stale", 409)
            values: list[Any] = [
                actor.user_id, project_row["transcript_id"],
                project_row["transcript_revision"], project_row["media_revision"],
            ]
            ids_clause = ""
            if request.recommendationIds is not None:
                ids_clause = " AND r.id=ANY(%s)"
                values.append(request.recommendationIds)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    f"""SELECT r.* FROM timeline_recommendations r
                    JOIN transcript_analyses a ON a.id=r.analysis_id
                    WHERE r.owner_user_id=%s AND r.transcript_id=%s
                    AND r.status='accepted' AND a.status='ready'
                    AND a.transcript_revision=%s AND a.media_revision=%s
                    {ids_clause} ORDER BY r.id FOR UPDATE OF r""",
                    values,
                )
                recommendations = [dict(row) for row in await cursor.fetchall()]
            if request.recommendationIds is not None and len(recommendations) != len(request.recommendationIds):
                raise OrchestrationError("recommendation_stale", "One or more recommendations are not eligible", 409)
            result = self.drafts.derive(
                ClipProjectV1.model_validate(project_row["project"]),
                recommendations,
                draft_name=request.draftName,
                minimum_range_duration_ms=request.options.minimumRangeDurationMs,
                include_accepted_fillers=request.options.includeAcceptedFillers,
                include_accepted_silence=request.options.includeAcceptedSilence,
            )
            if not result.consumed_recommendation_ids:
                raise OrchestrationError("draft_derivation_empty", "No accepted exclusion recommendation is eligible", 409)
            project = result.project.model_dump(mode="json")
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clip_projects SET name=%s,status='draft',project=%s,
                    revision=revision+1,latest_edl=NULL,latest_remapped_transcript=NULL,
                    latest_conversion_result=NULL,latest_edl_revision=NULL,
                    latest_remapped_transcript_revision=NULL,latest_conversion_revision=NULL,
                    latest_derivation_transcript_revision=NULL,
                    latest_derivation_result_identity=NULL,
                    latest_conversion_result_identity=NULL,
                    updated_at=now() WHERE id=%s AND owner_user_id=%s AND revision=%s
                    RETURNING *""",
                    (
                        project["name"], _json(project), project_id,
                        actor.user_id, request.expectedProjectRevision,
                    ),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise OrchestrationError("project_revision_conflict", "Project changed concurrently", 409)
                row = dict(row)
                await cursor.execute(
                    """INSERT INTO clip_project_versions(
                    clip_project_id,revision,project,created_by,change_summary,
                    version_source,transcript_revision,derivation_identity
                    ) VALUES (%s,%s,%s,%s,'Draft from accepted recommendations',
                    'accepted_recommendations',%s,%s)""",
                    (
                        project_id, row["revision"], _json(project), actor.user_id,
                        row["transcript_revision"], result.derivation_identity,
                    ),
                )
                for recommendation_id in result.consumed_recommendation_ids:
                    await cursor.execute(
                        """INSERT INTO clip_project_recommendation_consumptions(
                        owner_user_id,clip_project_id,project_revision,recommendation_id,
                        derivation_identity,created_by
                        ) VALUES (%s,%s,%s,%s,%s,%s)""",
                        (
                            actor.user_id, project_id, row["revision"], recommendation_id,
                            result.derivation_identity, actor.user_id,
                        ),
                    )
            response = {
                **self._safe_project_response(row),
                "consumedRecommendationIds": list(result.consumed_recommendation_ids),
                "warnings": list(result.warnings),
                "derivationIdentity": result.derivation_identity,
            }
            await self._complete(connection, record, response, resource_type="clip_project", resource_id=project_id)
            return response

    async def _create_job(self, connection, actor, project, *, job_type, input_value, identity):
        async with connection.cursor() as cursor:
            await cursor.execute(
                """INSERT INTO processing_jobs(
                id,owner_user_id,project_id,media_asset_id,job_type,status,
                priority,input,max_attempts,idempotency_key,execution_timeout_seconds
                ) VALUES (%s,%s,%s,%s,%s,'queued',15,%s,2,%s,300)
                ON CONFLICT(owner_user_id,job_type,idempotency_key)
                DO UPDATE SET updated_at=processing_jobs.updated_at RETURNING *""",
                (
                    uuid4(), actor.user_id, project["id"], project["source_media_asset_id"],
                    job_type, _json(input_value), identity,
                ),
            )
            return dict(await cursor.fetchone())

    async def request_derivation(self, actor, project_id, request: DeriveRequest, *, idempotency_key):
        payload = request.model_dump(mode="json")
        async with self.database.transaction() as connection:
            record, replay = await self._reserve(
                connection, actor, operation=f"derive:{project_id}", key=idempotency_key, request=payload
            )
            if replay is not None:
                return replay
            project = await self._project(connection, actor, project_id, lock=True)
            await self._assert_dependencies_current(connection, project)
            if project["revision"] != request.expectedRevision:
                raise OrchestrationError("project_revision_conflict", "Project revision is stale", 409)
            if not project["transcript_id"] or not project["transcript_revision"]:
                raise OrchestrationError("transcript_not_ready", "Project transcript is unavailable", 409)
            identity = canonical_hash({"projectId": project_id, **payload})
            value = ProjectDerivationJobInputV1(
                clipProjectId=project_id,
                expectedRevision=project["revision"],
                transcriptId=project["transcript_id"],
                expectedTranscriptRevision=project["transcript_revision"],
                expectedMediaRevision=project["media_revision"],
                includeRemappedTranscript=request.includeRemappedTranscript,
                requestIdentity=identity,
            ).model_dump(mode="json")
            job = await self._create_job(
                connection, actor, project, job_type="project_derivation",
                input_value=value, identity=identity,
            )
            response = {"status": job["status"], "jobId": str(job["id"]), "projectId": project_id, "projectRevision": project["revision"]}
            await self._complete(connection, record, response, code=202, resource_type="processing_job", resource_id=str(job["id"]))
            return response

    async def request_conversion(self, actor, project_id, request: ConversionRequest, *, idempotency_key):
        payload = request.model_dump(mode="json")
        async with self.database.transaction() as connection:
            record, replay = await self._reserve(
                connection, actor, operation=f"conversion:{project_id}", key=idempotency_key, request=payload
            )
            if replay is not None:
                return replay
            project = await self._project(connection, actor, project_id, lock=True)
            await self._assert_dependencies_current(connection, project)
            if project["revision"] != request.expectedRevision:
                raise OrchestrationError("project_revision_conflict", "Project revision is stale", 409)
            if (
                project["latest_edl_revision"] != project["revision"]
                or project["latest_edl"] is None
                or not project["latest_derivation_result_identity"]
            ):
                raise OrchestrationError("derived_data_missing", "Current EDL is unavailable", 409)
            if request.includeCaptions and (
                project["latest_remapped_transcript_revision"] != project["revision"]
                or project["latest_remapped_transcript"] is None
            ):
                raise OrchestrationError("derived_data_missing", "Current remapped transcript is unavailable", 409)
            identity = canonical_hash({"projectId": project_id, **payload})
            value = ProjectConversionRequestJobInputV1(
                clipProjectId=project_id,
                expectedRevision=project["revision"],
                targetProjectId=request.targetProjectId,
                includeCaptions=request.includeCaptions,
                requestIdentity=identity,
            ).model_dump(mode="json")
            job = await self._create_job(
                connection, actor, project, job_type="project_conversion",
                input_value=value, identity=identity,
            )
            response = {"status": job["status"], "jobId": str(job["id"]), "projectId": project_id, "projectRevision": project["revision"]}
            await self._complete(connection, record, response, code=202, resource_type="processing_job", resource_id=str(job["id"]))
            return response

    async def status(self, actor, project_id):
        detail = await self.get_detail(actor, project_id)
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT job_type,status FROM processing_jobs WHERE project_id=%s
                    AND owner_user_id=%s AND job_type IN (
                    'viral_candidate_analysis','smart_reframe',
                    'project_derivation','project_conversion')
                    ORDER BY created_at DESC""",
                    (project_id, actor.user_id),
                )
                jobs = [dict(row) for row in await cursor.fetchall()]
        latest = {}
        for row in jobs:
            latest.setdefault(row["job_type"], row["status"])
        analysis_status = {}
        for row in detail["analysisSummary"]:
            analysis_status[row["analysis_type"]] = row["status"]
        return {
            "projectId": project_id,
            "projectRevision": detail["revision"],
            "media": {"status": detail["media"]["status"]},
            "transcript": {"status": detail["transcript"]["status"]},
            "analyses": {
                "silence": analysis_status.get("silence", "not_requested"),
                "transcriptReview": analysis_status.get("transcript_review", "not_requested"),
                "viralCandidates": analysis_status.get("viral_candidates", "not_requested"),
            },
            "automaticClipper": {
                "candidateAnalysis": latest.get(
                    "viral_candidate_analysis",
                    analysis_status.get("viral_candidates", "not_requested"),
                ),
                "smartReframe": latest.get("smart_reframe", "not_requested"),
            },
            "recommendations": detail["recommendationSummary"],
            "derivation": {
                "status": latest.get("project_derivation", "not_requested"),
                "edl": detail["derived"]["edlStatus"],
                "remappedTranscript": detail["derived"]["remappedTranscriptStatus"],
            },
            "conversion": {
                "status": latest.get("project_conversion", detail["derived"]["conversionStatus"])
            },
        }

    async def get_job(self, actor, project_id, job_id):
        async with self.database.connection() as connection:
            await self._project(connection, actor, project_id)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT id,job_type,status,progress,current_stage,
                    attempt_count,max_attempts,output,failure_code,failure_message,
                    created_at,updated_at,started_at,completed_at
                    FROM processing_jobs WHERE id=%s AND project_id=%s
                    AND owner_user_id=%s
                    AND job_type IN (
                      'viral_candidate_analysis','smart_reframe',
                      'project_derivation','project_conversion'
                    )""",
                    (job_id, project_id, actor.user_id),
                )
                row = await cursor.fetchone()
        if row is None:
            raise OrchestrationError("project_job_not_found", "Project job was not found", 404)
        return dict(row)
