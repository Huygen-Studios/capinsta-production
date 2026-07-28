from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext
from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_orchestration.contracts import (
    ProjectConversionRequestJobInputV1,
    ProjectDerivationJobInputV1,
)
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError
from server.clipping_persistence.validation import validate_derived_caches

try:
    from contracts.clip_project_v1 import ClipProjectV1
    from contracts.transcript_document_v2 import TranscriptDocumentV2
except ImportError:
    from backend.contracts.clip_project_v1 import ClipProjectV1
    from backend.contracts.transcript_document_v2 import TranscriptDocumentV2

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


class ClippingRuntimeRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    @staticmethod
    async def _lock_job(connection, context: JobExecutionContext):
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
    async def _load_dependencies(connection, project_id: str):
        async with connection.cursor() as cursor:
            await cursor.execute(
                "SELECT * FROM clip_projects WHERE id=%s FOR UPDATE", (project_id,)
            )
            project_row = await cursor.fetchone()
            if project_row is None:
                return None, None, None
            project = dict(project_row)
            await cursor.execute(
                "SELECT * FROM media_assets WHERE id=%s FOR UPDATE",
                (project["source_media_asset_id"],),
            )
            asset_row = await cursor.fetchone()
            await cursor.execute(
                "SELECT * FROM transcripts WHERE id=%s FOR UPDATE",
                (project["transcript_id"],),
            )
            transcript_row = await cursor.fetchone()
        return (
            project,
            dict(asset_row) if asset_row else None,
            dict(transcript_row) if transcript_row else None,
        )

    @staticmethod
    def _validate_common(job, project, asset, value):
        if project is None or project["deleted_at"] is not None:
            raise ProcessingJobFailure(
                "project_not_found", "The clipping project no longer exists", retryable=False
            )
        if project["archived_at"] is not None or project["status"] == "archived":
            raise ProcessingJobFailure(
                "project_archived", "Archived projects cannot be processed", retryable=False
            )
        if asset is None or asset["deleted_at"] is not None or asset["status"] != "ready":
            raise ProcessingJobFailure(
                "media_not_ready", "The project media is not ready", retryable=False
            )
        if (
            job["job_type"] != value.jobType
            or job["project_id"] != project["id"]
            or job["owner_user_id"] != project["owner_user_id"]
            or job["media_asset_id"] != asset["id"]
            or project["source_media_asset_id"] != asset["id"]
        ):
            raise ProcessingJobFailure(
                "project_not_found", "The project is not authorized for this job", retryable=False
            )
        if project["revision"] != value.expectedRevision:
            raise ProcessingJobFailure(
                "project_revision_mismatch",
                "The project revision changed after planning",
                retryable=False,
            )
        return project, asset

    async def load_derivation(
        self, context: JobExecutionContext, value: ProjectDerivationJobInputV1
    ) -> tuple[ClipProjectV1, TranscriptDocumentV2]:
        try:
            async with self.database.transaction() as connection:
                job = await self._lock_job(connection, context)
                project, asset, transcript = await self._load_dependencies(
                    connection, value.clipProjectId
                )
                self._validate_common(job, project, asset, value)
                if asset["revision"] != value.expectedMediaRevision:
                    raise ProcessingJobFailure(
                        "media_revision_mismatch",
                        "The media revision changed after planning",
                        retryable=False,
                    )
                if (
                    project["media_revision"] != value.expectedMediaRevision
                    or project["transcript_id"] != value.transcriptId
                    or project["transcript_revision"] != value.expectedTranscriptRevision
                ):
                    raise ProcessingJobFailure(
                        "project_derivation_input_invalid",
                        "The project dependency identity changed",
                        retryable=False,
                    )
                if (
                    transcript is None
                    or transcript["deleted_at"] is not None
                    or transcript["status"] != "ready"
                ):
                    raise ProcessingJobFailure(
                        "transcript_not_ready",
                        "The project transcript is not ready",
                        retryable=False,
                    )
                if transcript["revision"] != value.expectedTranscriptRevision:
                    raise ProcessingJobFailure(
                        "transcript_revision_mismatch",
                        "The transcript revision changed after planning",
                        retryable=False,
                    )
                try:
                    project_contract = ClipProjectV1.model_validate(project["project"])
                    transcript_contract = TranscriptDocumentV2.model_validate(
                        transcript["document"]
                    )
                except ValidationError as exc:
                    raise ProcessingJobFailure(
                        "project_derivation_input_invalid",
                        "A derivation dependency contract is invalid",
                        retryable=False,
                    ) from exc
                return project_contract, transcript_contract
        except PersistenceError as exc:
            raise JobOrchestrationError(
                "database_temporarily_unavailable", exc.message
            ) from exc

    async def load_conversion(
        self, context: JobExecutionContext, value: ProjectConversionRequestJobInputV1
    ) -> tuple[dict[str, Any], str]:
        try:
            async with self.database.transaction() as connection:
                job = await self._lock_job(connection, context)
                project, asset, _ = await self._load_dependencies(
                    connection, value.clipProjectId
                )
                self._validate_common(job, project, asset, value)
                if (
                    project["latest_edl"] is None
                    or project["latest_edl_revision"] != value.expectedRevision
                    or not project["latest_derivation_result_identity"]
                ):
                    raise ProcessingJobFailure(
                        "conversion_dependency_missing",
                        "Current derivation data is unavailable",
                        retryable=False,
                    )
                if value.includeCaptions and (
                    project["latest_remapped_transcript"] is None
                    or project["latest_remapped_transcript_revision"]
                    != value.expectedRevision
                ):
                    raise ProcessingJobFailure(
                        "conversion_dependency_missing",
                        "Current remapped transcript is unavailable",
                        retryable=False,
                    )
                validate_derived_caches(
                    project_id=project["id"],
                    revision=project["revision"],
                    media_asset_id=asset["id"],
                    transcript_id=project["transcript_id"],
                    edl=project["latest_edl"],
                    remapped_transcript=(
                        project["latest_remapped_transcript"]
                        if value.includeCaptions
                        else None
                    ),
                    conversion_result=None,
                )
                payload = {
                    "schemaVersion": 1,
                    "clipProject": project["project"],
                    "editDecisionList": project["latest_edl"],
                    "remappedTranscript": (
                        project["latest_remapped_transcript"]
                        if value.includeCaptions
                        else None
                    ),
                    "targetProjectId": value.targetProjectId,
                    "targetProjectVersion": value.targetProjectSchemaVersion,
                    "options": {
                        "includeCaptions": value.includeCaptions,
                        "preserveDisabledRanges": False,
                        "createSeparateTracks": False,
                        "unsupportedFeaturePolicy": "warn",
                    },
                    "metadata": {},
                }
                return payload, project["latest_derivation_result_identity"]
        except PersistenceError as exc:
            raise JobOrchestrationError(
                "database_temporarily_unavailable", exc.message
            ) from exc

    async def finalize_derivation(
        self,
        context: JobExecutionContext,
        value: ProjectDerivationJobInputV1,
        *,
        edl: dict[str, Any],
        remapped: dict[str, Any] | None,
        identity: str,
        output: dict[str, Any],
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            job = await self._lock_job(connection, context)
            project, asset, transcript = await self._load_dependencies(
                connection, value.clipProjectId
            )
            self._validate_common(job, project, asset, value)
            if (
                asset["revision"] != value.expectedMediaRevision
                or project["media_revision"] != value.expectedMediaRevision
                or project["transcript_revision"] != value.expectedTranscriptRevision
                or transcript is None
                or transcript["revision"] != value.expectedTranscriptRevision
            ):
                raise ProcessingJobFailure(
                    "derived_data_stale",
                    "Derivation dependencies changed before finalization",
                    retryable=False,
                )
            validate_derived_caches(
                project_id=project["id"],
                revision=project["revision"],
                media_asset_id=asset["id"],
                transcript_id=transcript["id"],
                edl=edl,
                remapped_transcript=remapped,
                conversion_result=None,
            )
            prior_identity = project["latest_derivation_result_identity"]
            if (
                prior_identity
                and project["latest_edl_revision"] == project["revision"]
                and prior_identity != identity
            ):
                raise ProcessingJobFailure(
                    "derived_result_conflict",
                    "A different derivation result already exists",
                    retryable=False,
                )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clip_projects SET latest_edl=%s,
                    latest_remapped_transcript=%s,latest_edl_revision=revision,
                    latest_remapped_transcript_revision=%s,
                    latest_derivation_transcript_revision=%s,
                    latest_derivation_result_identity=%s,
                    latest_conversion_result=NULL,latest_conversion_revision=NULL,
                    latest_conversion_result_identity=NULL,updated_at=now()
                    WHERE id=%s AND revision=%s""",
                    (
                        _json(edl),
                        _json(remapped) if remapped is not None else None,
                        project["revision"] if remapped is not None else None,
                        value.expectedTranscriptRevision,
                        identity,
                        project["id"],
                        value.expectedRevision,
                    ),
                )
                if cursor.rowcount != 1:
                    raise JobOrchestrationError(
                        "job_lease_lost", "The project changed before finalization"
                    )
                await self._complete_job(cursor, context, output, identity)
            return output

    async def finalize_conversion(
        self,
        context: JobExecutionContext,
        value: ProjectConversionRequestJobInputV1,
        *,
        result: dict[str, Any],
        identity: str,
        output: dict[str, Any],
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            job = await self._lock_job(connection, context)
            project, asset, _ = await self._load_dependencies(
                connection, value.clipProjectId
            )
            self._validate_common(job, project, asset, value)
            if (
                project["latest_edl_revision"] != project["revision"]
                or not project["latest_derivation_result_identity"]
                or (
                    value.includeCaptions
                    and project["latest_remapped_transcript_revision"]
                    != project["revision"]
                )
            ):
                raise ProcessingJobFailure(
                    "derived_data_stale",
                    "Conversion dependencies changed before finalization",
                    retryable=False,
                )
            validate_derived_caches(
                project_id=project["id"],
                revision=project["revision"],
                media_asset_id=asset["id"],
                transcript_id=project["transcript_id"],
                edl=project["latest_edl"],
                remapped_transcript=(
                    project["latest_remapped_transcript"]
                    if value.includeCaptions
                    else None
                ),
                conversion_result=result,
            )
            prior_identity = project["latest_conversion_result_identity"]
            if (
                prior_identity
                and project["latest_conversion_revision"] == project["revision"]
                and prior_identity != identity
            ):
                raise ProcessingJobFailure(
                    "conversion_result_conflict",
                    "A different conversion result already exists",
                    retryable=False,
                )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clip_projects SET latest_conversion_result=%s,
                    latest_conversion_revision=revision,
                    latest_conversion_result_identity=%s,updated_at=now()
                    WHERE id=%s AND revision=%s""",
                    (_json(result), identity, project["id"], value.expectedRevision),
                )
                if cursor.rowcount != 1:
                    raise JobOrchestrationError(
                        "job_lease_lost", "The project changed before finalization"
                    )
                await self._complete_job(cursor, context, output, identity)
            return output

    @staticmethod
    async def _complete_job(cursor, context, output, identity):
        await cursor.execute(
            """UPDATE processing_jobs SET status='succeeded',progress=100,output=%s,
            error=NULL,failure_code=NULL,failure_message=NULL,finished_at=now(),
            worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,
            current_stage='completed',revision=revision+1,updated_at=now()
            WHERE id=%s""",
            (_json(output), context.job_id),
        )
        if cursor.rowcount != 1:
            raise JobOrchestrationError(
                "job_lease_lost", "The runtime job changed before finalization"
            )
        await cursor.execute(
            """UPDATE processing_job_attempts SET status='succeeded',
            finished_at=now(),lease_expires_at=NULL,output_summary=%s
            WHERE job_id=%s AND attempt_number=%s""",
            (
                _json({"resultIdentity": identity}),
                context.job_id,
                context.attempt_number,
            ),
        )
        if cursor.rowcount != 1:
            raise JobOrchestrationError(
                "job_lease_lost", "The runtime attempt changed before finalization"
            )

