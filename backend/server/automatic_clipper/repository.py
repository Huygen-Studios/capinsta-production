from __future__ import annotations

from typing import Any
from uuid import uuid4

from pydantic import ValidationError

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext, JobFailure
from server.clipping_jobs.policies import DEFAULT_JOB_POLICIES
from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_orchestration.contracts import ProjectDerivationJobInputV1
from server.clipping_orchestration.errors import OrchestrationError
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError
from server.clipping_persistence.models import AuthenticatedActor

try:
    from contracts.clip_project_v1 import ClipProjectV1
    from contracts.transcript_document_v2 import TranscriptDocumentV2
except ImportError:
    from backend.contracts.clip_project_v1 import ClipProjectV1
    from backend.contracts.transcript_document_v2 import TranscriptDocumentV2

from .contracts import (
    AutomaticClipperJobResultV1,
    CandidateSelectionRequestV1,
    ReframePlanV1,
    SmartReframeJobInputV1,
    ViralCandidateAnalysisDocumentV1,
    ViralCandidateAnalysisJobInputV1,
)
from .identity import (
    ANALYSIS_SPEC,
    canonical_hash,
    stable_analysis_id,
    stable_candidate_id,
)

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


Input = ViralCandidateAnalysisJobInputV1 | SmartReframeJobInputV1


class AutomaticClipperRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    async def plan_candidates(
        self,
        actor: AuthenticatedActor,
        project_id: str,
        *,
        expected_revision: int,
        regeneration_key: str | None = None,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT * FROM clip_projects WHERE id=%s
                    AND owner_user_id=%s AND deleted_at IS NULL FOR UPDATE""",
                    (project_id, actor.user_id),
                )
                project_row = await cursor.fetchone()
                if project_row is None:
                    raise OrchestrationError(
                        "project_not_found", "Clipping project was not found", 404
                    )
                project = dict(project_row)
                if project["revision"] != expected_revision:
                    raise OrchestrationError(
                        "project_revision_conflict", "Project revision is stale", 409
                    )
                if not project["transcript_id"] or not project["transcript_revision"]:
                    raise OrchestrationError(
                        "transcript_not_ready", "Project transcript is unavailable", 409
                    )
                await cursor.execute(
                    """SELECT * FROM media_assets WHERE id=%s
                    AND owner_user_id=%s AND deleted_at IS NULL FOR UPDATE""",
                    (project["source_media_asset_id"], actor.user_id),
                )
                asset_row = await cursor.fetchone()
                await cursor.execute(
                    """SELECT * FROM transcripts WHERE id=%s
                    AND owner_user_id=%s AND deleted_at IS NULL FOR UPDATE""",
                    (project["transcript_id"], actor.user_id),
                )
                transcript_row = await cursor.fetchone()
                if asset_row is None or transcript_row is None:
                    raise OrchestrationError(
                        "dependency_not_ready", "Project media or transcript is unavailable", 409
                    )
                asset, transcript = dict(asset_row), dict(transcript_row)
                if (
                    asset["status"] != "ready"
                    or transcript["status"] != "ready"
                    or asset["revision"] != project["media_revision"]
                    or transcript["revision"] != project["transcript_revision"]
                ):
                    raise OrchestrationError(
                        "dependency_revision_conflict",
                        "Project dependencies are not current",
                        409,
                    )
                analysis_id = stable_analysis_id(
                    project_id=project_id,
                    project_revision=project["revision"],
                    transcript_id=transcript["id"],
                    transcript_revision=transcript["revision"],
                    media_revision=asset["revision"],
                    regeneration_key=regeneration_key,
                )
                analysis_spec = (
                    ANALYSIS_SPEC
                    if regeneration_key is None
                    else {
                        **ANALYSIS_SPEC,
                        "regenerationKeyHash": canonical_hash(regeneration_key),
                    }
                )
                analysis_spec_hash = canonical_hash(analysis_spec)
                await cursor.execute(
                    """INSERT INTO transcript_analyses(
                    id,owner_user_id,media_asset_id,transcript_id,transcript_revision,
                    media_revision,analysis_type,schema_version,analysis_spec,
                    analysis_spec_hash,status)
                    VALUES(%s,%s,%s,%s,%s,%s,'viral_candidates',1,%s,%s,'queued')
                    ON CONFLICT(id) DO UPDATE
                    SET updated_at=transcript_analyses.updated_at RETURNING *""",
                    (
                        analysis_id,
                        actor.user_id,
                        asset["id"],
                        transcript["id"],
                        transcript["revision"],
                        asset["revision"],
                        _json(analysis_spec),
                        analysis_spec_hash,
                    ),
                )
                analysis = dict(await cursor.fetchone())
                identity = canonical_hash(
                    {
                        "analysisId": analysis_id,
                        "projectId": project_id,
                        "projectRevision": project["revision"],
                    }
                )
                payload = ViralCandidateAnalysisJobInputV1(
                    analysisId=analysis_id,
                    clipProjectId=project_id,
                    expectedProjectRevision=project["revision"],
                    mediaAssetId=asset["id"],
                    expectedMediaRevision=asset["revision"],
                    transcriptId=transcript["id"],
                    expectedTranscriptRevision=transcript["revision"],
                    analysisSpecHash=analysis_spec_hash,
                ).model_dump(mode="json")
                policy = DEFAULT_JOB_POLICIES["viral_candidate_analysis"]
                await cursor.execute(
                    """INSERT INTO processing_jobs(
                    id,owner_user_id,project_id,media_asset_id,job_type,status,
                    priority,input,max_attempts,idempotency_key,execution_timeout_seconds)
                    VALUES(%s,%s,%s,%s,'viral_candidate_analysis','queued',%s,%s,%s,%s,%s)
                    ON CONFLICT(owner_user_id,job_type,idempotency_key)
                    DO UPDATE SET updated_at=processing_jobs.updated_at RETURNING *""",
                    (
                        uuid4(),
                        actor.user_id,
                        project_id,
                        asset["id"],
                        policy.priority,
                        _json(payload),
                        policy.maximum_attempts,
                        identity,
                        policy.default_timeout_seconds,
                    ),
                )
                job = dict(await cursor.fetchone())
        return {
            "analysisId": analysis_id,
            "jobId": str(job["id"]),
            "status": job["status"],
            "reused": analysis["status"] == "ready",
            "projectRevision": project["revision"],
        }

    @staticmethod
    async def _locked(
        connection: Any, context: JobExecutionContext, value: Input
    ) -> tuple[dict[str, Any], ...]:
        async with connection.cursor() as cursor:
            await cursor.execute(
                "SELECT *,now() AS database_now FROM processing_jobs WHERE id=%s FOR UPDATE",
                (context.job_id,),
            )
            job_row = await cursor.fetchone()
            if job_row is None:
                raise JobOrchestrationError(
                    "job_not_found", "Processing job was not found"
                )
            job = dict(job_row)
            ProcessingJobLeaseRepository._validate_lease(
                job,
                worker_id=context.worker_id,
                claim_token=context.claim_token,
                allowed_statuses=frozenset({"claimed", "running"}),
            )
            await cursor.execute(
                "SELECT * FROM clip_projects WHERE id=%s FOR UPDATE",
                (value.clipProjectId,),
            )
            project_row = await cursor.fetchone()
            candidate_row = None
            if isinstance(value, ViralCandidateAnalysisJobInputV1):
                await cursor.execute(
                    "SELECT * FROM transcript_analyses WHERE id=%s FOR UPDATE",
                    (value.analysisId,),
                )
                subject_row = await cursor.fetchone()
                media_asset_id = value.mediaAssetId
                transcript_id = value.transcriptId
            else:
                await cursor.execute(
                    "SELECT * FROM clip_candidates WHERE id=%s FOR UPDATE",
                    (value.candidateId,),
                )
                candidate_row = await cursor.fetchone()
                subject_row = candidate_row
                project_dict = dict(project_row) if project_row else {}
                media_asset_id = project_dict.get("source_media_asset_id")
                transcript_id = project_dict.get("transcript_id")
            await cursor.execute(
                "SELECT * FROM media_assets WHERE id=%s FOR UPDATE",
                (media_asset_id,),
            )
            asset_row = await cursor.fetchone()
            await cursor.execute(
                "SELECT * FROM transcripts WHERE id=%s FOR UPDATE",
                (transcript_id,),
            )
            transcript_row = await cursor.fetchone()
        return tuple(
            dict(row) if row is not None else None
            for row in (
                job_row,
                project_row,
                asset_row,
                transcript_row,
                subject_row,
                candidate_row,
            )
        )

    @staticmethod
    def _validate_locked(
        locked: tuple[dict[str, Any], ...], value: Input
    ) -> tuple[dict[str, Any], ...]:
        job, project, asset, transcript, subject, candidate = locked
        if project is None or project["deleted_at"] is not None:
            raise ProcessingJobFailure(
                "project_not_found", "The clipping project no longer exists", retryable=False
            )
        if asset is None or transcript is None or subject is None:
            raise ProcessingJobFailure(
                "dependency_not_found", "A clipping dependency no longer exists", retryable=False
            )
        if (
            job["job_type"] != value.jobType
            or project["owner_user_id"] != job["owner_user_id"]
            or asset["owner_user_id"] != job["owner_user_id"]
            or transcript["owner_user_id"] != job["owner_user_id"]
            or project["source_media_asset_id"] != asset["id"]
            or project["transcript_id"] != transcript["id"]
        ):
            raise ProcessingJobFailure(
                "dependency_not_found", "The clipping dependency is unauthorized", retryable=False
            )
        if (
            project["revision"] != value.expectedProjectRevision
            or asset["revision"] != value.expectedMediaRevision
            or transcript["revision"] != value.expectedTranscriptRevision
            or project["media_revision"] != asset["revision"]
            or project["transcript_revision"] != transcript["revision"]
        ):
            raise ProcessingJobFailure(
                "stale_revision", "A clipping dependency changed after planning", retryable=False
            )
        if asset["status"] != "ready" or transcript["status"] != "ready":
            raise ProcessingJobFailure(
                "dependency_not_ready", "A clipping dependency is not ready", retryable=False
            )
        if isinstance(value, ViralCandidateAnalysisJobInputV1):
            if (
                subject["analysis_type"] != "viral_candidates"
                or subject["analysis_spec_hash"] != value.analysisSpecHash
                or subject["transcript_revision"] != transcript["revision"]
                or subject["media_revision"] != asset["revision"]
            ):
                raise ProcessingJobFailure(
                    "analysis_identity_mismatch",
                    "Candidate analysis lineage changed",
                    retryable=False,
                )
        else:
            if (
                candidate is None
                or candidate["clip_project_id"] != project["id"]
                or candidate["project_revision"] != project["revision"]
                or candidate["media_revision"] != asset["revision"]
                or candidate["transcript_revision"] != transcript["revision"]
                or candidate["status"] not in {"proposed", "selected"}
            ):
                raise ProcessingJobFailure(
                    "candidate_stale", "The candidate is no longer selectable", retryable=False
                )
        try:
            transcript_document = TranscriptDocumentV2.model_validate(
                transcript["document"]
            )
            project_document = ClipProjectV1.model_validate(project["project"])
        except ValidationError as exc:
            raise ProcessingJobFailure(
                "dependency_contract_invalid",
                "A clipping dependency contract is invalid",
                retryable=False,
            ) from exc
        return project, asset, transcript, subject, transcript_document, project_document

    async def begin_analysis(
        self, context: JobExecutionContext, value: ViralCandidateAnalysisJobInputV1
    ):
        async with self.database.transaction() as connection:
            locked = await self._locked(connection, context, value)
            result = self._validate_locked(locked, value)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE transcript_analyses SET status='analyzing',
                    failure=NULL,revision=revision+1,updated_at=now()
                    WHERE id=%s AND status<>'ready'""",
                    (value.analysisId,),
                )
                await cursor.execute(
                    """SELECT document FROM transcript_analyses
                    WHERE transcript_id=%s AND analysis_type='silence'
                    AND status='ready' AND transcript_revision=%s
                    AND media_revision=%s ORDER BY ready_at DESC LIMIT 1""",
                    (
                        value.transcriptId,
                        value.expectedTranscriptRevision,
                        value.expectedMediaRevision,
                    ),
                )
                silence_row = await cursor.fetchone()
            return (*result, dict(silence_row)["document"] if silence_row else None)

    async def finalize_analysis(
        self,
        context: JobExecutionContext,
        value: ViralCandidateAnalysisJobInputV1,
        *,
        document: ViralCandidateAnalysisDocumentV1,
        result: AutomaticClipperJobResultV1,
    ) -> dict[str, Any]:
        payload = document.model_dump(mode="json")
        provider_identity = canonical_hash(payload)
        if result.resultIdentity != provider_identity:
            raise ProcessingJobFailure(
                "candidate_result_invalid",
                "Candidate result identity is invalid",
                retryable=False,
            )
        payload["candidates"] = [
            {
                **candidate.model_dump(mode="json"),
                "candidateId": stable_candidate_id(value.analysisId, ordinal),
            }
            for ordinal, candidate in enumerate(document.candidates, 1)
        ]
        persisted_identity = canonical_hash(payload)
        async with self.database.transaction() as connection:
            locked = await self._locked(connection, context, value)
            project, asset, transcript, analysis, transcript_document, _ = (
                self._validate_locked(locked, value)
            )
            word_ids = {word.id for word in transcript_document.words}
            segment_ids = {segment.id for segment in transcript_document.segments}
            for candidate in document.candidates:
                if (
                    not set(candidate.transcriptEvidence.wordIds) <= word_ids
                    or not set(candidate.transcriptEvidence.segmentIds) <= segment_ids
                ):
                    raise ProcessingJobFailure(
                        "candidate_result_invalid",
                        "Candidate evidence contains an invalid transcript reference",
                        retryable=False,
                    )
            if (
                analysis["status"] == "ready"
                and analysis["result_identity"] != persisted_identity
            ):
                raise ProcessingJobFailure(
                    "candidate_result_conflict",
                    "A different candidate result is already ready",
                    retryable=False,
                )
            output = result.model_dump(mode="json")
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clip_candidates SET status='superseded',updated_at=now()
                    WHERE clip_project_id=%s AND status='proposed'
                    AND analysis_id<>%s""",
                    (project["id"], value.analysisId),
                )
                for ordinal, candidate in enumerate(document.candidates, 1):
                    candidate_json = candidate.model_dump(mode="json")
                    candidate_id = stable_candidate_id(value.analysisId, ordinal)
                    candidate_json["candidateId"] = candidate_id
                    await cursor.execute(
                        """INSERT INTO clip_candidates(
                        id,owner_user_id,clip_project_id,analysis_id,media_asset_id,
                        media_revision,transcript_id,transcript_revision,project_revision,
                        candidate,status)
                        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'proposed')
                        ON CONFLICT(id) DO UPDATE SET
                        candidate=EXCLUDED.candidate,updated_at=now()
                        WHERE clip_candidates.status='proposed'""",
                        (
                            candidate_id,
                            asset["owner_user_id"],
                            project["id"],
                            value.analysisId,
                            asset["id"],
                            asset["revision"],
                            transcript["id"],
                            transcript["revision"],
                            project["revision"],
                            _json(candidate_json),
                        ),
                    )
                output["resultIdentity"] = persisted_identity
                await cursor.execute(
                    """UPDATE transcript_analyses SET status='ready',document=%s,
                    summary=%s,failure=NULL,result_identity=%s,
                    ready_at=COALESCE(ready_at,now()),revision=revision+1,updated_at=now()
                    WHERE id=%s""",
                    (
                        _json(payload),
                        _json({"candidateCount": len(document.candidates)}),
                        persisted_identity,
                        value.analysisId,
                    ),
                )
                await self._complete_job(cursor, context, output, persisted_identity)
            return output

    async def list_candidates(
        self, actor: AuthenticatedActor, project_id: str
    ) -> dict[str, Any]:
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT id,project_revision,candidate,status,reframe_plan,
                    composition,selected_project_revision,created_at,updated_at
                    FROM clip_candidates WHERE clip_project_id=%s
                    AND owner_user_id=%s ORDER BY
                    (candidate->>'viralScore')::integer DESC,
                    (candidate->>'sourceStartMs')::bigint,id""",
                    (project_id, actor.user_id),
                )
                rows = [dict(row) for row in await cursor.fetchall()]
        return {
            "projectId": project_id,
            "items": [
                {
                    **row["candidate"],
                    "status": row["status"],
                    "projectRevision": row["project_revision"],
                    "reframePlan": row["reframe_plan"],
                    "composition": row["composition"],
                    "selectedProjectRevision": row["selected_project_revision"],
                    "createdAt": row["created_at"],
                    "updatedAt": row["updated_at"],
                }
                for row in rows
            ],
        }

    async def reject_candidate(
        self,
        actor: AuthenticatedActor,
        project_id: str,
        candidate_id: str,
        *,
        expected_revision: int,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT revision FROM clip_projects WHERE id=%s
                    AND owner_user_id=%s AND deleted_at IS NULL FOR UPDATE""",
                    (project_id, actor.user_id),
                )
                project = await cursor.fetchone()
                if project is None:
                    raise OrchestrationError(
                        "project_not_found", "Clipping project was not found", 404
                    )
                if project["revision"] != expected_revision:
                    raise OrchestrationError(
                        "project_revision_conflict", "Project revision is stale", 409
                    )
                await cursor.execute(
                    """UPDATE clip_candidates SET status='rejected',updated_at=now()
                    WHERE id=%s AND clip_project_id=%s AND owner_user_id=%s
                    AND project_revision=%s AND status IN ('proposed','rejected')
                    RETURNING status""",
                    (
                        candidate_id,
                        project_id,
                        actor.user_id,
                        expected_revision,
                    ),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise OrchestrationError(
                        "candidate_not_selectable",
                        "Candidate is missing, stale, or already selected",
                        409,
                    )
        return {
            "projectId": project_id,
            "candidateId": candidate_id,
            "status": "rejected",
            "projectRevision": expected_revision,
        }

    async def queue_selection(
        self,
        actor: AuthenticatedActor,
        project_id: str,
        candidate_id: str,
        request: CandidateSelectionRequestV1,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT * FROM clip_projects WHERE id=%s
                    AND owner_user_id=%s AND deleted_at IS NULL FOR UPDATE""",
                    (project_id, actor.user_id),
                )
                project_row = await cursor.fetchone()
                if project_row is None:
                    raise OrchestrationError(
                        "project_not_found", "Clipping project was not found", 404
                    )
                project = dict(project_row)
                if project["revision"] != request.expectedRevision:
                    raise OrchestrationError(
                        "project_revision_conflict", "Project revision is stale", 409
                    )
                await cursor.execute(
                    """SELECT * FROM clip_candidates WHERE id=%s
                    AND clip_project_id=%s AND owner_user_id=%s FOR UPDATE""",
                    (candidate_id, project_id, actor.user_id),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise OrchestrationError(
                        "candidate_not_found", "Candidate was not found", 404
                    )
                candidate = dict(row)
                if candidate["status"] == "selected":
                    return {
                        "candidateId": candidate_id,
                        "status": "selected",
                        "projectRevision": candidate["selected_project_revision"],
                        "reused": True,
                    }
                if (
                    candidate["status"] != "proposed"
                    or candidate["project_revision"] != project["revision"]
                ):
                    raise OrchestrationError(
                        "candidate_not_selectable", "Candidate is stale or rejected", 409
                    )
                identity = canonical_hash(
                    {
                        "candidateId": candidate_id,
                        "projectRevision": project["revision"],
                        "selection": request.model_dump(mode="json"),
                    }
                )
                payload = SmartReframeJobInputV1(
                    clipProjectId=project_id,
                    candidateId=candidate_id,
                    expectedProjectRevision=project["revision"],
                    expectedMediaRevision=project["media_revision"],
                    expectedTranscriptRevision=project["transcript_revision"],
                    selection=request,
                ).model_dump(mode="json")
                policy = DEFAULT_JOB_POLICIES["smart_reframe"]
                await cursor.execute(
                    """INSERT INTO processing_jobs(
                    id,owner_user_id,project_id,media_asset_id,job_type,status,
                    priority,input,max_attempts,idempotency_key,execution_timeout_seconds)
                    VALUES(%s,%s,%s,%s,'smart_reframe','queued',%s,%s,%s,%s,%s)
                    ON CONFLICT(owner_user_id,job_type,idempotency_key)
                    DO UPDATE SET updated_at=processing_jobs.updated_at RETURNING *""",
                    (
                        uuid4(),
                        actor.user_id,
                        project_id,
                        project["source_media_asset_id"],
                        policy.priority,
                        _json(payload),
                        policy.maximum_attempts,
                        identity,
                        policy.default_timeout_seconds,
                    ),
                )
                job = dict(await cursor.fetchone())
        return {
            "candidateId": candidate_id,
            "status": job["status"],
            "jobId": str(job["id"]),
            "projectRevision": project["revision"],
            "reused": job["status"] != "queued",
        }

    async def begin_reframe(
        self, context: JobExecutionContext, value: SmartReframeJobInputV1
    ):
        async with self.database.transaction() as connection:
            locked = await self._locked(connection, context, value)
            result = self._validate_locked(locked, value)
            candidate = result[3]["candidate"]
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT source_start_ms,source_end_ms
                    FROM timeline_recommendations
                    WHERE owner_user_id=%s AND transcript_id=%s
                    AND recommendation_type='remove_silence' AND status='accepted'
                    AND source_start_ms>=%s AND source_end_ms<=%s
                    ORDER BY source_start_ms,source_end_ms,id""",
                    (
                        result[0]["owner_user_id"],
                        result[2]["id"],
                        candidate["sourceStartMs"],
                        candidate["sourceEndMs"],
                    ),
                )
                accepted_silences = [
                    {
                        "sourceStartMs": row["source_start_ms"],
                        "sourceEndMs": row["source_end_ms"],
                    }
                    for row in await cursor.fetchall()
                ]
            return (*result, accepted_silences)

    async def finalize_composition(
        self,
        context: JobExecutionContext,
        value: SmartReframeJobInputV1,
        *,
        reframe_plan: ReframePlanV1,
        project_document: dict[str, Any],
        composition_report: dict[str, Any],
        result_identity: str,
        warnings: list[str],
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            locked = await self._locked(connection, context, value)
            project, asset, transcript, candidate, _, _ = self._validate_locked(
                locked, value
            )
            try:
                composed = ClipProjectV1.model_validate(project_document)
            except ValidationError as exc:
                raise ProcessingJobFailure(
                    "composition_result_invalid",
                    "Composed clip project is invalid",
                    retryable=False,
                ) from exc
            if (
                composed.clipProjectId != project["id"]
                or composed.revision != project["revision"] + 1
                or composed.transcriptRevision != transcript["revision"]
                or composed.sourceMedia.mediaId != str(asset["id"])
            ):
                raise ProcessingJobFailure(
                    "composition_result_invalid",
                    "Composed project provenance is invalid",
                    retryable=False,
                )
            output = AutomaticClipperJobResultV1(
                jobType="smart_reframe",
                clipProjectId=project["id"],
                projectRevision=composed.revision,
                candidateId=value.candidateId,
                resultIdentity=result_identity,
                warnings=sorted(set(warnings)),
            ).model_dump(mode="json")
            derivation_identity = canonical_hash(
                {
                    "projectId": project["id"],
                    "expectedRevision": composed.revision,
                    "includeRemappedTranscript": True,
                }
            )
            derivation_input = ProjectDerivationJobInputV1(
                clipProjectId=project["id"],
                expectedRevision=composed.revision,
                transcriptId=transcript["id"],
                expectedTranscriptRevision=transcript["revision"],
                expectedMediaRevision=asset["revision"],
                includeRemappedTranscript=True,
                requestIdentity=derivation_identity,
                metadata={"candidateId": value.candidateId},
            ).model_dump(mode="json")
            policy = DEFAULT_JOB_POLICIES["project_derivation"]
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clip_projects SET project=%s,name=%s,status='draft',
                    revision=%s,latest_edl=NULL,latest_remapped_transcript=NULL,
                    latest_conversion_result=NULL,latest_edl_revision=NULL,
                    latest_remapped_transcript_revision=NULL,latest_conversion_revision=NULL,
                    latest_derivation_result_identity=NULL,
                    latest_conversion_result_identity=NULL,updated_at=now()
                    WHERE id=%s AND revision=%s""",
                    (
                        _json(project_document),
                        composed.name,
                        composed.revision,
                        project["id"],
                        value.expectedProjectRevision,
                    ),
                )
                if cursor.rowcount != 1:
                    raise ProcessingJobFailure(
                        "stale_revision",
                        "Project changed before composition finalization",
                        retryable=False,
                    )
                await cursor.execute(
                    """INSERT INTO clip_project_versions(
                    clip_project_id,revision,project,created_by,change_summary,
                    version_source,transcript_revision)
                    VALUES(%s,%s,%s,%s,'Automatic candidate composition',
                    'system_import',%s)""",
                    (
                        project["id"],
                        composed.revision,
                        _json(project_document),
                        project["owner_user_id"],
                        transcript["revision"],
                    ),
                )
                await cursor.execute(
                    """UPDATE clip_candidates SET status='selected',
                    reframe_plan=%s,reframe_identity=%s,composition=%s,
                    composition_identity=%s,selected_project_revision=%s,
                    updated_at=now() WHERE id=%s""",
                    (
                        _json(reframe_plan.model_dump(mode="json")),
                        canonical_hash(reframe_plan.model_dump(mode="json")),
                        _json(composition_report),
                        result_identity,
                        composed.revision,
                        value.candidateId,
                    ),
                )
                await cursor.execute(
                    """UPDATE clip_candidates SET status='superseded',updated_at=now()
                    WHERE clip_project_id=%s AND id<>%s AND status='proposed'""",
                    (project["id"], value.candidateId),
                )
                await cursor.execute(
                    """INSERT INTO processing_jobs(
                    id,owner_user_id,project_id,media_asset_id,job_type,status,
                    priority,input,max_attempts,idempotency_key,execution_timeout_seconds)
                    VALUES(%s,%s,%s,%s,'project_derivation','queued',%s,%s,%s,%s,%s)
                    ON CONFLICT(owner_user_id,job_type,idempotency_key)
                    DO UPDATE SET updated_at=processing_jobs.updated_at""",
                    (
                        uuid4(),
                        project["owner_user_id"],
                        project["id"],
                        asset["id"],
                        policy.priority,
                        _json(derivation_input),
                        policy.maximum_attempts,
                        derivation_identity,
                        policy.default_timeout_seconds,
                    ),
                )
                await self._complete_job(cursor, context, output, result_identity)
            return output

    @staticmethod
    async def _complete_job(
        cursor: Any,
        context: JobExecutionContext,
        output: dict[str, Any],
        identity: str,
    ) -> None:
        await cursor.execute(
            """UPDATE processing_jobs SET status='succeeded',progress=100,output=%s,
            error=NULL,failure_code=NULL,failure_message=NULL,finished_at=now(),
            worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,current_stage='completed',
            revision=revision+1,updated_at=now() WHERE id=%s""",
            (_json(output), context.job_id),
        )
        if cursor.rowcount != 1:
            raise JobOrchestrationError(
                "job_lease_lost", "Automatic clipper job changed before finalization"
            )
        await cursor.execute(
            """UPDATE processing_job_attempts SET status='succeeded',finished_at=now(),
            lease_expires_at=NULL,output_summary=%s
            WHERE job_id=%s AND attempt_number=%s""",
            (
                _json({"resultIdentity": identity}),
                context.job_id,
                context.attempt_number,
            ),
        )
        if cursor.rowcount != 1:
            raise JobOrchestrationError(
                "job_lease_lost", "Automatic clipper attempt changed before finalization"
            )

    async def finalize_failure(
        self, context: JobExecutionContext, value: Input, failure: ProcessingJobFailure
    ) -> None:
        safe = JobFailure(failure.code, failure.safe_message, False, {}).as_dict()
        async with self.database.transaction() as connection:
            locked = await self._locked(connection, context, value)
            self._validate_locked(locked, value)
            async with connection.cursor() as cursor:
                if isinstance(value, ViralCandidateAnalysisJobInputV1):
                    await cursor.execute(
                        """UPDATE transcript_analyses SET status='failed',failure=%s,
                        revision=revision+1,updated_at=now()
                        WHERE id=%s AND status<>'ready'""",
                        (_json(safe), value.analysisId),
                    )
                await cursor.execute(
                    """UPDATE processing_jobs SET status='failed',error=%s,
                    failure_code=%s,failure_message=%s,finished_at=now(),
                    worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,
                    next_retry_at=NULL,current_stage='failed',revision=revision+1,
                    updated_at=now() WHERE id=%s""",
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


__all__ = ["AutomaticClipperRepository"]
