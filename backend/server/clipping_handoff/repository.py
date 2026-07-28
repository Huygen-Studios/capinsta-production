from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.models import AuthenticatedActor

from .config import HandoffConfig
from .contracts import (
    CapinstaProjectHandoffManifestV1,
    CompleteHandoffRequestV1,
    PrepareHandoffRequestV1,
    ServerBackedMediaDescriptorV1,
    collect_project_media_ids,
)
from .errors import HandoffError
from .identity import canonical_hash, handoff_request_identity

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


class HandoffRepository:
    def __init__(self, database: DurableDatabase, config: HandoffConfig) -> None:
        self.database = database
        self.config = config

    @staticmethod
    async def _owned_row(connection, actor, handoff_id, *, lock=False):
        suffix = " FOR UPDATE" if lock else ""
        async with connection.cursor() as cursor:
            await cursor.execute(
                f"""SELECT *,now() AS database_now FROM project_handoffs
                WHERE id=%s AND owner_user_id=%s{suffix}""",
                (handoff_id, actor.user_id),
            )
            row = await cursor.fetchone()
        if row is None:
            raise HandoffError(
                "handoff_not_found", "Project handoff was not found", 404
            )
        return dict(row)

    @staticmethod
    async def _current_conversion(connection, row):
        async with connection.cursor() as cursor:
            await cursor.execute(
                """SELECT revision,latest_conversion_result_identity,
                latest_conversion_revision,deleted_at FROM clip_projects
                WHERE id=%s AND owner_user_id=%s""",
                (row["clip_project_id"], row["owner_user_id"]),
            )
            project = await cursor.fetchone()
        if (
            project is None
            or project["deleted_at"] is not None
            or project["revision"] != row["clip_project_revision"]
            or project["latest_conversion_revision"] != row["clip_project_revision"]
            or project["latest_conversion_result_identity"]
            != row["conversion_result_identity"]
        ):
            raise HandoffError(
                "handoff_conversion_stale",
                "The project conversion is no longer current",
                409,
            )

    def _manifest(self, row) -> CapinstaProjectHandoffManifestV1:
        try:
            manifest = CapinstaProjectHandoffManifestV1.model_validate(
                row["manifest"]
            )
        except Exception as exc:
            raise HandoffError(
                "handoff_manifest_invalid",
                "The project handoff manifest is invalid",
                422,
            ) from exc
        if (
            manifest.handoffId != row["id"]
            or manifest.clipProjectId != row["clip_project_id"]
            or manifest.clipProjectRevision != row["clip_project_revision"]
            or manifest.conversionResultIdentity
            != row["conversion_result_identity"]
            or manifest.targetProjectId != row["target_project_id"]
            or manifest.expiresAt != row["expires_at"]
        ):
            raise HandoffError(
                "handoff_manifest_invalid",
                "The project handoff manifest provenance is invalid",
                422,
            )
        return manifest

    async def prepare(
        self,
        actor: AuthenticatedActor,
        project_id: str,
        request: PrepareHandoffRequestV1,
        *,
        idempotency_key: str,
    ) -> dict[str, Any]:
        request_value = request.model_dump(mode="json")
        request_hash = canonical_hash({"projectId": project_id, **request_value})
        scope = f"{actor.user_id}:clipping:handoff:{project_id}"
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """INSERT INTO idempotency_records(
                    owner_user_id,scope,idempotency_key,request_hash
                    ) VALUES (%s,%s,%s,%s)
                    ON CONFLICT(scope,idempotency_key) DO NOTHING RETURNING *""",
                    (actor.user_id, scope, idempotency_key, request_hash),
                )
                record = await cursor.fetchone()
                if record is None:
                    await cursor.execute(
                        """SELECT * FROM idempotency_records
                        WHERE scope=%s AND idempotency_key=%s FOR UPDATE""",
                        (scope, idempotency_key),
                    )
                    existing = dict(await cursor.fetchone())
                    if (
                        existing["owner_user_id"] != actor.user_id
                        or existing["request_hash"] != request_hash
                    ):
                        raise HandoffError(
                            "idempotency_conflict",
                            "Idempotency key was used for a different request",
                            409,
                        )
                    if existing["status"] == "completed" and isinstance(
                        existing["response"], dict
                    ):
                        return existing["response"]
                    raise HandoffError(
                        "idempotency_in_progress",
                        "Equivalent handoff preparation is in progress",
                        409,
                    )
                record = dict(record)
                await cursor.execute(
                    """SELECT *,now() AS database_now FROM clip_projects
                    WHERE id=%s AND owner_user_id=%s FOR UPDATE""",
                    (project_id, actor.user_id),
                )
                project_row = await cursor.fetchone()
            if project_row is None or project_row["deleted_at"] is not None:
                raise HandoffError(
                    "handoff_not_found", "Clipping project was not found", 404
                )
            project = dict(project_row)
            if project["archived_at"] is not None or project["status"] == "archived":
                raise HandoffError(
                    "handoff_project_revision_mismatch",
                    "Archived clipping projects cannot create handoffs",
                    409,
                )
            if project["revision"] != request.expectedRevision:
                raise HandoffError(
                    "handoff_project_revision_mismatch",
                    "Clipping project revision is stale",
                    409,
                )
            conversion = project["latest_conversion_result"]
            identity = project["latest_conversion_result_identity"]
            if conversion is None or identity is None:
                raise HandoffError(
                    "handoff_conversion_missing",
                    "A current conversion result is required",
                    409,
                )
            if project["latest_conversion_revision"] != project["revision"]:
                raise HandoffError(
                    "handoff_conversion_stale",
                    "The conversion result is stale",
                    409,
                )
            if (
                conversion.get("sourceClipProjectId") != project_id
                or conversion.get("sourceClipProjectRevision") != project["revision"]
                or conversion.get("targetProjectId") != request.targetProjectId
                or conversion.get("schemaVersion") != 1
            ):
                raise HandoffError(
                    "handoff_conversion_mismatch",
                    "Conversion provenance does not match the handoff request",
                    409,
                )
            converted_project = conversion.get("project")
            media_reference = conversion.get("mediaReference") or {}
            mapping = conversion.get("mapping") or {}
            if (
                not isinstance(converted_project, dict)
                or converted_project.get("version") != 35
                or (converted_project.get("metadata") or {}).get("id")
                != request.targetProjectId
                or media_reference.get("requiresMediaAttachment") is not True
            ):
                raise HandoffError(
                    "handoff_conversion_mismatch",
                    "Converted project contract is invalid",
                    409,
                )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT * FROM media_assets WHERE id=%s
                    AND owner_user_id=%s FOR UPDATE""",
                    (project["source_media_asset_id"], actor.user_id),
                )
                asset_row = await cursor.fetchone()
            if asset_row is None or asset_row["deleted_at"] is not None:
                raise HandoffError(
                    "handoff_media_missing", "Source media was not found", 409
                )
            asset = dict(asset_row)
            if asset["status"] != "ready":
                raise HandoffError(
                    "handoff_media_not_ready", "Source media is not ready", 409
                )
            media_id = str(asset["id"])
            referenced_ids = collect_project_media_ids(converted_project)
            if (
                media_reference.get("mediaId") != media_id
                or media_reference.get("sourceAssetId") != media_id
                or mapping.get("sourceMediaId") != media_id
                or referenced_ids != {media_id}
            ):
                raise HandoffError(
                    "handoff_media_identity_mismatch",
                    "Converted media identity does not match the durable asset",
                    409,
                )
            request_identity = handoff_request_identity(
                actor_id=actor.user_id,
                clip_project_id=project_id,
                clip_project_revision=project["revision"],
                conversion_result_identity=identity,
                target_project_id=request.targetProjectId,
                include_captions=request.options.includeCaptions,
            )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                    (request_identity,),
                )
                await cursor.execute(
                    """UPDATE project_handoffs SET status='expired',
                    revision=revision+1,updated_at=now()
                    WHERE request_identity=%s AND status IN ('prepared','claimed')
                    AND expires_at<=now()""",
                    (request_identity,),
                )
                await cursor.execute(
                    """SELECT * FROM project_handoffs
                    WHERE request_identity=%s
                    AND status IN ('prepared','claimed','imported')
                    ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
                    (request_identity,),
                )
                existing = await cursor.fetchone()
            if existing is not None:
                response = self._prepare_response(dict(existing), replayed=True)
            else:
                handoff_id = uuid4()
                expires_at = project["database_now"] + timedelta(
                    seconds=self.config.ttl_seconds
                )
                media_kind = (
                    asset["media_kind"]
                    if asset["media_kind"] in {"video", "audio", "image"}
                    else "unknown"
                )
                manifest = CapinstaProjectHandoffManifestV1(
                    handoffId=handoff_id,
                    clipProjectId=project_id,
                    clipProjectRevision=project["revision"],
                    conversionResultIdentity=identity,
                    targetProjectId=request.targetProjectId,
                    project=converted_project,
                    mediaAttachments=[
                        ServerBackedMediaDescriptorV1(
                            mediaId=media_id,
                            mediaAssetId=asset["id"],
                            mediaKind=media_kind,
                            mimeType=asset["mime_type"],
                            displayName=asset["display_name"],
                            sizeBytes=asset["size_bytes"],
                            durationMs=asset["duration_ms"],
                            width=asset["width"],
                            height=asset["height"],
                        )
                    ],
                    provenance={
                        "sourceClipProjectId": project_id,
                        "sourceClipProjectRevision": project["revision"],
                        "conversionSchemaVersion": 1,
                        "convertedAt": None,
                    },
                    expiresAt=expires_at,
                    warnings=sorted(
                        {
                            warning.get("category", "unknown")
                            for warning in conversion.get("warnings") or []
                            if isinstance(warning, dict)
                        }
                    ),
                    metadata={},
                )
                manifest_value = manifest.bounded_json(
                    self.config.maximum_manifest_bytes
                )
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """INSERT INTO project_handoffs(
                        id,owner_user_id,clip_project_id,clip_project_revision,
                        conversion_result_identity,target_project_id,status,
                        manifest_schema_version,manifest,request_identity,expires_at
                        ) VALUES (%s,%s,%s,%s,%s,%s,'prepared',1,%s,%s,%s)
                        RETURNING *""",
                        (
                            handoff_id,
                            actor.user_id,
                            project_id,
                            project["revision"],
                            identity,
                            request.targetProjectId,
                            _json(manifest_value),
                            request_identity,
                            expires_at,
                        ),
                    )
                    created = dict(await cursor.fetchone())
                response = self._prepare_response(created, replayed=False)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE idempotency_records SET status='completed',
                    response_code=201,response=%s,resource_type='project_handoff',
                    resource_id=%s,updated_at=now() WHERE id=%s""",
                    (_json(response), response["handoffId"], record["id"]),
                )
            return response

    @staticmethod
    def _prepare_response(row, *, replayed):
        return {
            "handoffId": str(row["id"]),
            "status": row["status"],
            "targetProjectId": row["target_project_id"],
            "expiresAt": row["expires_at"].isoformat(),
            "openPath": f"/editor/handoff/{row['id']}",
            "replayed": replayed,
        }

    async def status(self, actor, handoff_id):
        async with self.database.connection() as connection:
            row = await self._owned_row(connection, actor, handoff_id)
        status = (
            "expired"
            if row["status"] in {"prepared", "claimed"}
            and row["expires_at"] <= row["database_now"]
            else row["status"]
        )
        return {
            "handoffId": str(row["id"]),
            "status": status,
            "targetProjectId": row["target_project_id"],
            "expiresAt": row["expires_at"].isoformat(),
            "claimedAt": (
                row["claimed_at"].isoformat() if row["claimed_at"] else None
            ),
            "completedAt": (
                row["completed_at"].isoformat() if row["completed_at"] else None
            ),
        }

    async def claim(self, actor, handoff_id):
        async with self.database.transaction() as connection:
            row = await self._owned_row(connection, actor, handoff_id, lock=True)
            if row["status"] in {"prepared", "claimed"} and (
                row["expires_at"] <= row["database_now"]
            ):
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """UPDATE project_handoffs SET status='expired',
                        revision=revision+1,updated_at=now() WHERE id=%s""",
                        (handoff_id,),
                    )
                raise HandoffError(
                    "handoff_expired", "Project handoff has expired", 410
                )
            if row["status"] == "cancelled":
                raise HandoffError(
                    "handoff_cancelled", "Project handoff was cancelled", 409
                )
            if row["status"] == "expired":
                raise HandoffError(
                    "handoff_expired", "Project handoff has expired", 410
                )
            if row["status"] == "imported":
                if row["expires_at"] <= row["database_now"]:
                    raise HandoffError(
                        "handoff_expired", "Project handoff has expired", 410
                    )
                manifest = self._manifest(row)
                return {
                    "handoff": manifest.model_dump(mode="json"),
                    "claim": {
                        "status": "imported",
                        "claimedAt": row["claimed_at"].isoformat(),
                    },
                }
            await self._current_conversion(connection, row)
            if row["status"] == "prepared":
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """UPDATE project_handoffs SET status='claimed',
                        claimed_at=now(),claimed_by=%s,revision=revision+1,
                        updated_at=now() WHERE id=%s RETURNING *,now() AS database_now""",
                        (actor.user_id, handoff_id),
                    )
                    row = dict(await cursor.fetchone())
            elif row["claimed_by"] != actor.user_id:
                raise HandoffError(
                    "handoff_not_found", "Project handoff was not found", 404
                )
            manifest = self._manifest(row)
            return {
                "handoff": manifest.model_dump(mode="json"),
                "claim": {
                    "status": "claimed",
                    "claimedAt": row["claimed_at"].isoformat(),
                },
            }

    async def complete(
        self,
        actor,
        handoff_id,
        request: CompleteHandoffRequestV1,
    ):
        async with self.database.transaction() as connection:
            row = await self._owned_row(connection, actor, handoff_id, lock=True)
            if row["status"] == "imported":
                if (
                    row["imported_project_id"] == request.importedProjectId
                    and row["imported_project_revision"]
                    == request.importedProjectRevision
                ):
                    return self._completion_response(row, replayed=True)
                raise HandoffError(
                    "handoff_project_conflict",
                    "Handoff completion conflicts with the imported project",
                    409,
                )
            if row["status"] != "claimed":
                raise HandoffError(
                    "handoff_not_claimed",
                    "Project handoff must be claimed before completion",
                    409,
                )
            if row["expires_at"] <= row["database_now"]:
                raise HandoffError(
                    "handoff_expired", "Project handoff has expired", 410
                )
            if request.importedProjectId != row["target_project_id"]:
                raise HandoffError(
                    "handoff_project_conflict",
                    "Imported project ID does not match the handoff target",
                    409,
                )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE project_handoffs SET status='imported',
                    imported_project_id=%s,imported_project_revision=%s,
                    completed_at=now(),revision=revision+1,updated_at=now()
                    WHERE id=%s RETURNING *,now() AS database_now""",
                    (
                        request.importedProjectId,
                        request.importedProjectRevision,
                        handoff_id,
                    ),
                )
                row = dict(await cursor.fetchone())
            return self._completion_response(row, replayed=False)

    @staticmethod
    def _completion_response(row, *, replayed):
        return {
            "handoffId": str(row["id"]),
            "status": "imported",
            "importedProjectId": row["imported_project_id"],
            "importedProjectRevision": row["imported_project_revision"],
            "completedAt": row["completed_at"].isoformat(),
            "replayed": replayed,
        }

    async def cancel(self, actor, handoff_id):
        async with self.database.transaction() as connection:
            row = await self._owned_row(connection, actor, handoff_id, lock=True)
            if row["status"] == "imported":
                raise HandoffError(
                    "handoff_already_imported",
                    "Imported handoff cannot be cancelled",
                    409,
                )
            if row["status"] in {"cancelled", "expired"}:
                return {"handoffId": str(row["id"]), "status": row["status"]}
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE project_handoffs SET status='cancelled',
                    revision=revision+1,updated_at=now()
                    WHERE id=%s RETURNING status""",
                    (handoff_id,),
                )
                status = (await cursor.fetchone())["status"]
            return {"handoffId": str(row["id"]), "status": status}
