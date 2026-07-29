from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

from server.clipping_handoff.contracts import (
    ServerBackedMediaDescriptorV1,
    collect_project_media_ids,
)
from server.clipping_persistence.database import DurableDatabase
from server.clipping_jobs.errors import (
    JobOrchestrationError,
    ProcessingJobFailure,
)
from server.clipping_jobs.models import JobExecutionContext, JobFailure
from server.clipping_jobs.repository import ProcessingJobLeaseRepository

from .config import ClippingExportConfig
from .contracts import (
    ClippingExportJobInputV1,
    ClippingExportRequestV1,
    ClippingPreviewManifestV1,
    PreviewRequestV1,
)
from .errors import ClippingExportError
from .identity import canonical_hash, export_spec

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


class ClippingExportRepository:
    def __init__(self, database: DurableDatabase, config: ClippingExportConfig) -> None:
        self.database = database
        self.config = config
        self.storage_provider = config.storage_backend

    @staticmethod
    async def _reserve(connection, actor, scope, key, request):
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
        if (
            existing["owner_user_id"] != actor.user_id
            or existing["request_hash"] != request_hash
        ):
            raise ClippingExportError(
                "idempotency_conflict",
                "Idempotency key was used for a different request",
                409,
            )
        if existing["status"] == "completed" and isinstance(existing["response"], dict):
            return existing, existing["response"]
        raise ClippingExportError(
            "idempotency_in_progress",
            "Equivalent request is still in progress",
            409,
        )

    @staticmethod
    async def _complete(connection, record, response, *, resource_type, resource_id):
        async with connection.cursor() as cursor:
            await cursor.execute(
                """UPDATE idempotency_records SET status='completed',
                response_code=201,response=%s,resource_type=%s,resource_id=%s,
                updated_at=now() WHERE id=%s""",
                (_json(response), resource_type, resource_id, record["id"]),
            )

    async def _current(
        self, connection, actor, project_id: str, expected_revision: int
    ):
        async with connection.cursor() as cursor:
            await cursor.execute(
                """SELECT *,now() AS database_now FROM clip_projects
                WHERE id=%s AND owner_user_id=%s FOR UPDATE""",
                (project_id, actor.user_id),
            )
            project_row = await cursor.fetchone()
        if project_row is None or project_row["deleted_at"] is not None:
            raise ClippingExportError(
                "project_not_found", "Clipping project was not found", 404
            )
        project = dict(project_row)
        if project["archived_at"] is not None or project["status"] == "archived":
            raise ClippingExportError(
                "project_not_current", "Archived projects cannot be rendered", 409
            )
        if project["revision"] != expected_revision:
            raise ClippingExportError(
                "project_revision_mismatch", "Clipping project revision is stale", 409
            )
        current = project["revision"]
        if (
            project["latest_edl"] is None
            or project["latest_edl_revision"] != current
            or not project["latest_derivation_result_identity"]
        ):
            raise ClippingExportError(
                "edl_missing", "A current edit decision list is required", 409
            )
        if (
            project["latest_remapped_transcript"] is None
            or project["latest_remapped_transcript_revision"] != current
        ):
            raise ClippingExportError(
                "remapped_transcript_missing",
                "A current remapped transcript is required",
                409,
            )
        if (
            project["latest_conversion_result"] is None
            or project["latest_conversion_revision"] != current
            or not project["latest_conversion_result_identity"]
        ):
            raise ClippingExportError(
                "conversion_missing", "A current conversion is required", 409
            )
        conversion = project["latest_conversion_result"]
        if (
            conversion.get("schemaVersion") != 1
            or conversion.get("sourceClipProjectId") != project_id
            or conversion.get("sourceClipProjectRevision") != current
            or not isinstance(conversion.get("project"), dict)
            or conversion["project"].get("version") != 35
        ):
            raise ClippingExportError(
                "conversion_stale", "Conversion provenance is invalid", 409
            )
        async with connection.cursor() as cursor:
            await cursor.execute(
                """SELECT * FROM media_assets WHERE id=%s
                AND owner_user_id=%s FOR UPDATE""",
                (project["source_media_asset_id"], actor.user_id),
            )
            asset_row = await cursor.fetchone()
        if asset_row is None or asset_row["deleted_at"] is not None:
            raise ClippingExportError(
                "media_missing", "Attached media was not found", 409
            )
        asset = dict(asset_row)
        if asset["status"] != "ready":
            raise ClippingExportError(
                "media_not_ready", "Attached media is not ready", 409
            )
        if (
            not asset["size_bytes"]
            or asset["size_bytes"] > self.config.maximum_output_bytes * 4
            or asset["duration_ms"] is None
        ):
            raise ClippingExportError(
                "media_attachment_invalid",
                "Attached media exceeds export safety limits or lacks duration",
                409,
            )
        media_id = str(asset["id"])
        if collect_project_media_ids(conversion["project"]) != {media_id}:
            raise ClippingExportError(
                "media_attachment_mismatch",
                "Converted project media does not match its durable attachment",
                409,
            )
        return project, asset

    @staticmethod
    def _identities(project):
        return (
            project["latest_derivation_result_identity"],
            canonical_hash(project["latest_remapped_transcript"]),
            project["latest_conversion_result_identity"],
        )

    @staticmethod
    def _attachment(asset):
        return ServerBackedMediaDescriptorV1(
            mediaId=str(asset["id"]),
            mediaAssetId=asset["id"],
            mediaKind=asset["media_kind"]
            if asset["media_kind"] in {"video", "audio", "image"}
            else "unknown",
            mimeType=asset["mime_type"],
            displayName=asset["display_name"],
            sizeBytes=asset["size_bytes"],
            durationMs=asset["duration_ms"],
            width=asset["width"],
            height=asset["height"],
        )

    async def preview(
        self, actor, project_id, request: PreviewRequestV1, *, idempotency_key
    ):
        payload = {"projectId": project_id, **request.model_dump(mode="json")}
        scope = f"{actor.user_id}:clipping:preview:{project_id}"
        async with self.database.transaction() as connection:
            record, replay = await self._reserve(
                connection, actor, scope, idempotency_key, payload
            )
            if replay is not None:
                return replay
            project, asset = await self._current(
                connection, actor, project_id, request.expectedRevision
            )
            edl_identity, remapped_identity, conversion_identity = self._identities(
                project
            )
            conversion = project["latest_conversion_result"]
            manifest = ClippingPreviewManifestV1(
                previewId=uuid4(),
                clipProjectId=project_id,
                clipProjectRevision=project["revision"],
                edlResultIdentity=edl_identity,
                remappedTranscriptResultIdentity=remapped_identity,
                conversionResultIdentity=conversion_identity,
                capinstaProject=conversion["project"],
                mediaAttachments=[self._attachment(asset)],
                durationMs=project["latest_edl"]["outputDurationMs"],
                expiresAt=project["database_now"]
                + timedelta(seconds=self.config.preview_ttl_seconds),
                warnings=sorted(
                    {
                        item.get("category", "unknown")
                        for item in conversion.get("warnings") or []
                        if isinstance(item, dict)
                    }
                ),
            )
            manifest_value = manifest.bounded_json(self.config.maximum_manifest_bytes)
            response = {
                "previewId": str(manifest.previewId),
                "status": "ready",
                "expiresAt": manifest.expiresAt.isoformat(),
                "manifest": manifest_value,
                "replayed": False,
            }
            await self._complete(
                connection,
                record,
                response,
                resource_type="clipping_preview",
                resource_id=str(manifest.previewId),
            )
            return response

    @staticmethod
    def _safe_export(row):
        return {
            "exportId": str(row["id"]),
            "clipProjectId": row["clip_project_id"],
            "clipProjectRevision": row["clip_project_revision"],
            "preset": row["export_spec"]["preset"],
            "status": row["status"],
            "jobId": str(row["processing_job_id"]),
            "progress": float(row.get("progress") or 0),
            "stage": row.get("current_stage") or row["status"],
            "mimeType": row["mime_type"],
            "sizeBytes": row["size_bytes"],
            "durationMs": row["duration_ms"],
            "width": row["width"],
            "height": row["height"],
            "readyAt": row["ready_at"].isoformat() if row["ready_at"] else None,
            "createdAt": row["created_at"].isoformat(),
            "updatedAt": row["updated_at"].isoformat(),
        }

    async def create(
        self, actor, project_id, request: ClippingExportRequestV1, *, idempotency_key
    ):
        payload = {"projectId": project_id, **request.model_dump(mode="json")}
        scope = f"{actor.user_id}:clipping:export:{project_id}"
        async with self.database.transaction() as connection:
            record, replay = await self._reserve(
                connection, actor, scope, idempotency_key, payload
            )
            if replay is not None:
                return {**replay, "replayed": True}
            project, _asset = await self._current(
                connection, actor, project_id, request.expectedProjectRevision
            )
            edl_identity, remapped_identity, conversion_identity = self._identities(
                project
            )
            spec = export_spec()
            spec_hash = canonical_hash(spec)
            request_identity = canonical_hash(
                {
                    "ownerUserId": str(actor.user_id),
                    "clipProjectId": project_id,
                    "clipProjectRevision": project["revision"],
                    "edlResultIdentity": edl_identity,
                    "remappedTranscriptResultIdentity": remapped_identity,
                    "conversionResultIdentity": conversion_identity,
                    "exportSpecHash": spec_hash,
                }
            )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                    (request_identity,),
                )
                await cursor.execute(
                    """SELECT e.*,j.progress,j.current_stage FROM clipping_exports e
                    JOIN processing_jobs j ON j.id=e.processing_job_id
                    WHERE e.request_identity=%s
                    AND e.status IN ('queued','rendering','verifying','uploading','ready')
                    ORDER BY e.created_at DESC LIMIT 1 FOR UPDATE""",
                    (request_identity,),
                )
                existing = await cursor.fetchone()
                if existing is not None:
                    response = {**self._safe_export(dict(existing)), "replayed": True}
                else:
                    export_id = uuid4()
                    job_id = uuid4()
                    job_input = ClippingExportJobInputV1(
                        exportId=export_id,
                        clipProjectId=project_id,
                        expectedProjectRevision=project["revision"],
                        edlResultIdentity=edl_identity,
                        remappedTranscriptResultIdentity=remapped_identity,
                        conversionResultIdentity=conversion_identity,
                        exportSpecHash=spec_hash,
                        requestIdentity=request_identity,
                    ).model_dump(mode="json")
                    job_idempotency_key = canonical_hash(
                        {
                            "requestIdentity": request_identity,
                            "exportId": str(export_id),
                        }
                    )
                    await cursor.execute(
                        """INSERT INTO processing_jobs(
                        id,owner_user_id,project_id,media_asset_id,job_type,status,
                        priority,input,max_attempts,idempotency_key,execution_timeout_seconds
                        ) VALUES (%s,%s,%s,%s,'clip_export','queued',10,%s,3,%s,%s)""",
                        (
                            job_id,
                            actor.user_id,
                            project_id,
                            project["source_media_asset_id"],
                            _json(job_input),
                            job_idempotency_key,
                            self.config.timeout_seconds,
                        ),
                    )
                    await cursor.execute(
                        """INSERT INTO clipping_exports(
                        id,owner_user_id,clip_project_id,clip_project_revision,
                        edl_result_identity,remapped_transcript_result_identity,
                        conversion_result_identity,export_spec,export_spec_hash,
                        request_identity,status,processing_job_id
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'queued',%s)
                        RETURNING *""",
                        (
                            export_id,
                            actor.user_id,
                            project_id,
                            project["revision"],
                            edl_identity,
                            remapped_identity,
                            conversion_identity,
                            _json(spec),
                            spec_hash,
                            request_identity,
                            job_id,
                        ),
                    )
                    row = dict(await cursor.fetchone())
                    row.update(progress=0, current_stage="queued")
                    response = {**self._safe_export(row), "replayed": False}
            await self._complete(
                connection,
                record,
                response,
                resource_type="clipping_export",
                resource_id=response["exportId"],
            )
            return response

    async def get(self, actor, export_id: UUID):
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT e.*,j.progress,j.current_stage FROM clipping_exports e
                    JOIN processing_jobs j ON j.id=e.processing_job_id
                    WHERE e.id=%s AND e.owner_user_id=%s AND e.deleted_at IS NULL""",
                    (export_id, actor.user_id),
                )
                row = await cursor.fetchone()
        if row is None:
            raise ClippingExportError(
                "export_not_found", "Clipping export was not found", 404
            )
        return self._safe_export(dict(row))

    async def list(self, actor, project_id: str):
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT 1 FROM clip_projects WHERE id=%s
                    AND owner_user_id=%s AND deleted_at IS NULL""",
                    (project_id, actor.user_id),
                )
                if await cursor.fetchone() is None:
                    raise ClippingExportError(
                        "project_not_found", "Clipping project was not found", 404
                    )
                await cursor.execute(
                    """SELECT e.*,j.progress,j.current_stage FROM clipping_exports e
                    JOIN processing_jobs j ON j.id=e.processing_job_id
                    WHERE e.clip_project_id=%s AND e.owner_user_id=%s
                    AND e.deleted_at IS NULL ORDER BY e.created_at DESC LIMIT 100""",
                    (project_id, actor.user_id),
                )
                rows = await cursor.fetchall()
        return {"items": [self._safe_export(dict(row)) for row in rows]}

    async def cancel(self, actor, export_id: UUID):
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT e.*,j.status AS job_status FROM clipping_exports e
                    JOIN processing_jobs j ON j.id=e.processing_job_id
                    WHERE e.id=%s AND e.owner_user_id=%s FOR UPDATE OF e,j""",
                    (export_id, actor.user_id),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise ClippingExportError(
                        "export_not_found", "Clipping export was not found", 404
                    )
                value = dict(row)
                if value["status"] == "ready":
                    raise ClippingExportError(
                        "export_already_ready", "Ready exports cannot be cancelled", 409
                    )
                if value["status"] in {"cancelled", "failed"}:
                    return {"exportId": str(export_id), "status": value["status"]}
                immediate = value["job_status"] in {"queued", "retry_wait"}
                job_status = "cancelled" if immediate else "cancel_requested"
                await cursor.execute(
                    """UPDATE processing_jobs SET status=%s,
                    cancel_requested_at=COALESCE(cancel_requested_at,now()),
                    cancelled_at=CASE WHEN %s='cancelled' THEN now() ELSE cancelled_at END,
                    finished_at=CASE WHEN %s='cancelled' THEN now() ELSE finished_at END,
                    current_stage=%s,revision=revision+1,updated_at=now()
                    WHERE id=%s""",
                    (
                        job_status,
                        job_status,
                        job_status,
                        job_status,
                        value["processing_job_id"],
                    ),
                )
                export_status = "cancelled" if immediate else value["status"]
                if immediate:
                    await cursor.execute(
                        """UPDATE clipping_exports SET status='cancelled',
                        revision=revision+1,updated_at=now() WHERE id=%s""",
                        (export_id,),
                    )
                return {
                    "exportId": str(export_id),
                    "status": export_status,
                    "jobStatus": job_status,
                }

    async def download_record(self, actor, export_id: UUID):
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT * FROM clipping_exports WHERE id=%s
                    AND owner_user_id=%s AND deleted_at IS NULL""",
                    (export_id, actor.user_id),
                )
                row = await cursor.fetchone()
        if row is None:
            raise ClippingExportError(
                "export_not_found", "Clipping export was not found", 404
            )
        value = dict(row)
        if value["status"] != "ready":
            raise ClippingExportError(
                "export_not_ready", "Clipping export is not ready", 409
            )
        return value

    @staticmethod
    async def _locked_job(connection, context: JobExecutionContext):
        async with connection.cursor() as cursor:
            await cursor.execute(
                "SELECT *,now() AS database_now FROM processing_jobs WHERE id=%s FOR UPDATE",
                (context.job_id,),
            )
            row = await cursor.fetchone()
        if row is None:
            raise JobOrchestrationError("job_not_found", "Processing job was not found")
        job = dict(row)
        ProcessingJobLeaseRepository._validate_lease(
            job,
            worker_id=context.worker_id,
            claim_token=context.claim_token,
            allowed_statuses=frozenset({"claimed", "running"}),
        )
        return job

    @staticmethod
    async def _locked_export(connection, export_id):
        async with connection.cursor() as cursor:
            await cursor.execute(
                "SELECT * FROM clipping_exports WHERE id=%s FOR UPDATE", (export_id,)
            )
            row = await cursor.fetchone()
        if row is None:
            raise ProcessingJobFailure(
                "export_not_found",
                "The clipping export no longer exists",
                retryable=False,
            )
        return dict(row)

    @staticmethod
    def _validate_worker_target(job, export, project, asset, value):
        if (
            job["job_type"] != "clip_export"
            or job["project_id"] != value.clipProjectId
            or job["media_asset_id"] != asset["id"]
            or job["owner_user_id"] != project["owner_user_id"]
            or export["processing_job_id"] != job["id"]
            or export["owner_user_id"] != project["owner_user_id"]
            or export["clip_project_id"] != project["id"]
            or export["clip_project_revision"] != value.expectedProjectRevision
            or export["request_identity"] != value.requestIdentity
            or export["export_spec_hash"] != value.exportSpecHash
        ):
            raise ProcessingJobFailure(
                "export_identity_mismatch",
                "Export job identity is invalid",
                retryable=False,
            )
        if (
            project["deleted_at"] is not None
            or project["revision"] != value.expectedProjectRevision
        ):
            raise ProcessingJobFailure(
                "export_revision_stale",
                "Project changed before export completed",
                retryable=False,
            )
        identities = (
            project["latest_derivation_result_identity"],
            canonical_hash(project["latest_remapped_transcript"])
            if project["latest_remapped_transcript"] is not None
            else None,
            project["latest_conversion_result_identity"],
        )
        expected = (
            value.edlResultIdentity,
            value.remappedTranscriptResultIdentity,
            value.conversionResultIdentity,
        )
        if identities != expected or (
            project["latest_edl_revision"] != project["revision"]
            or project["latest_remapped_transcript_revision"] != project["revision"]
            or project["latest_conversion_revision"] != project["revision"]
        ):
            raise ProcessingJobFailure(
                "export_dependencies_stale",
                "Derived clipping data changed before export completed",
                retryable=False,
            )
        if asset["deleted_at"] is not None or asset["status"] != "ready":
            raise ProcessingJobFailure(
                "source_media_not_ready",
                "Attached source media is unavailable",
                retryable=True,
            )
        if not asset["storage_bucket"] or not asset["storage_path"]:
            raise ProcessingJobFailure(
                "source_media_not_ready",
                "Attached source media has no storage object",
                retryable=True,
            )

    async def begin_render(self, context, value):
        async with self.database.transaction() as connection:
            job = await self._locked_job(connection, context)
            export = await self._locked_export(connection, value.exportId)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT * FROM clip_projects WHERE id=%s FOR UPDATE",
                    (value.clipProjectId,),
                )
                project_row = await cursor.fetchone()
                if project_row is None:
                    raise ProcessingJobFailure(
                        "project_not_found",
                        "Clipping project was not found",
                        retryable=False,
                    )
                project = dict(project_row)
                await cursor.execute(
                    "SELECT * FROM media_assets WHERE id=%s FOR UPDATE",
                    (project["source_media_asset_id"],),
                )
                asset_row = await cursor.fetchone()
                if asset_row is None:
                    raise ProcessingJobFailure(
                        "source_media_not_ready",
                        "Attached media was not found",
                        retryable=False,
                    )
                asset = dict(asset_row)
            self._validate_worker_target(job, export, project, asset, value)
            if (
                not asset["size_bytes"]
                or asset["size_bytes"] > self.config.maximum_output_bytes * 4
                or asset["duration_ms"] is None
            ):
                raise ProcessingJobFailure(
                    "source_media_not_ready",
                    "Attached media exceeds export safety limits or lacks duration",
                    retryable=False,
                )
            if export["status"] == "ready":
                return {"ready": True, "export": export}
            if export["status"] not in {
                "queued",
                "rendering",
                "verifying",
                "uploading",
            }:
                raise ProcessingJobFailure(
                    "export_not_renderable",
                    "Export cannot run in its current state",
                    retryable=False,
                )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clipping_exports SET status='rendering',
                    failure=NULL,revision=revision+1,updated_at=now()
                    WHERE id=%s RETURNING *""",
                    (value.exportId,),
                )
                export = dict(await cursor.fetchone())
            return {
                "ready": False,
                "export": export,
                "project": project,
                "asset": asset,
                "edl": project["latest_edl"],
                "convertedProject": project["latest_conversion_result"]["project"],
            }

    async def mark_worker_stage(self, context, value, status):
        if status not in {"verifying", "uploading"}:
            raise ValueError("unsupported clipping export stage")
        async with self.database.transaction() as connection:
            job = await self._locked_job(connection, context)
            export = await self._locked_export(connection, value.exportId)
            if (
                export["request_identity"] != value.requestIdentity
                or job["project_id"] != value.clipProjectId
            ):
                raise JobOrchestrationError("job_lease_lost", "Export identity changed")
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clipping_exports SET status=%s,
                    revision=revision+1,updated_at=now() WHERE id=%s""",
                    (status, value.exportId),
                )

    async def finalize_success(self, context, value, output):
        result_identity = canonical_hash(output)
        async with self.database.transaction() as connection:
            job = await self._locked_job(connection, context)
            export = await self._locked_export(connection, value.exportId)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT * FROM clip_projects WHERE id=%s FOR UPDATE",
                    (value.clipProjectId,),
                )
                project = dict(await cursor.fetchone())
                await cursor.execute(
                    "SELECT * FROM media_assets WHERE id=%s FOR UPDATE",
                    (project["source_media_asset_id"],),
                )
                asset = dict(await cursor.fetchone())
            self._validate_worker_target(job, export, project, asset, value)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clipping_exports SET status='ready',
                    storage_provider=%s,storage_bucket=%s,storage_path=%s,mime_type=%s,size_bytes=%s,
                    duration_ms=%s,width=%s,height=%s,checksum=%s,
                    result_identity=%s,failure=NULL,ready_at=now(),
                    revision=revision+1,updated_at=now()
                    WHERE id=%s AND request_identity=%s""",
                    (
                        self.storage_provider,
                        output["storageBucket"],
                        output["storagePath"],
                        output["mimeType"],
                        output["sizeBytes"],
                        output["durationMs"],
                        output["width"],
                        output["height"],
                        output["checksum"],
                        result_identity,
                        value.exportId,
                        value.requestIdentity,
                    ),
                )
                if cursor.rowcount != 1:
                    raise JobOrchestrationError(
                        "job_lease_lost", "Export changed before finalization"
                    )
                public_output = {
                    "exportId": str(value.exportId),
                    "projectId": value.clipProjectId,
                    "projectRevision": value.expectedProjectRevision,
                    "resultIdentity": result_identity,
                    "sizeBytes": output["sizeBytes"],
                    "durationMs": output["durationMs"],
                    "width": output["width"],
                    "height": output["height"],
                }
                await cursor.execute(
                    """UPDATE processing_jobs SET status='succeeded',progress=100,
                    output=%s,error=NULL,failure_code=NULL,failure_message=NULL,
                    finished_at=now(),worker_id=NULL,claim_token=NULL,
                    lease_expires_at=NULL,current_stage='completed',
                    revision=revision+1,updated_at=now() WHERE id=%s""",
                    (_json(public_output), context.job_id),
                )
                await cursor.execute(
                    """UPDATE processing_job_attempts SET status='succeeded',
                    finished_at=now(),lease_expires_at=NULL,output_summary=%s
                    WHERE job_id=%s AND attempt_number=%s""",
                    (
                        _json(
                            {
                                "exportId": str(value.exportId),
                                "resultIdentity": result_identity,
                            }
                        ),
                        context.job_id,
                        context.attempt_number,
                    ),
                )
            return public_output

    async def finalize_permanent_failure(self, context, value, failure):
        safe = JobFailure(failure.code, failure.safe_message, False, {}).as_dict()
        async with self.database.transaction() as connection:
            await self._locked_job(connection, context)
            export = await self._locked_export(connection, value.exportId)
            if export["request_identity"] != value.requestIdentity:
                raise JobOrchestrationError("job_lease_lost", "Export identity changed")
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clipping_exports SET status='failed',failure=%s,
                    revision=revision+1,updated_at=now() WHERE id=%s""",
                    (_json(safe), value.exportId),
                )
                await cursor.execute(
                    """UPDATE processing_jobs SET status='failed',error=%s,
                    failure_code=%s,failure_message=%s,finished_at=now(),
                    worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,
                    next_retry_at=NULL,current_stage='failed',
                    revision=revision+1,updated_at=now() WHERE id=%s""",
                    (
                        _json(safe),
                        failure.code[:100],
                        failure.safe_message[:1000],
                        context.job_id,
                    ),
                )
                await cursor.execute(
                    """UPDATE processing_job_attempts SET status='failed',
                    finished_at=now(),lease_expires_at=NULL,error=%s
                    WHERE job_id=%s AND attempt_number=%s""",
                    (_json(safe), context.job_id, context.attempt_number),
                )

    async def release_after_cancellation(self, context, value):
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT *,now() AS database_now FROM processing_jobs WHERE id=%s FOR UPDATE",
                    (context.job_id,),
                )
                row = await cursor.fetchone()
                if row is None:
                    return
                ProcessingJobLeaseRepository._validate_lease(
                    dict(row),
                    worker_id=context.worker_id,
                    claim_token=context.claim_token,
                    allowed_statuses=frozenset({"cancel_requested"}),
                )
                await cursor.execute(
                    """UPDATE clipping_exports SET status='cancelled',
                    revision=revision+1,updated_at=now()
                    WHERE id=%s AND status<>'ready'""",
                    (value.exportId,),
                )
