from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext, JobFailure
from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError

try:
    from contracts.transcript_document_v2 import TranscriptDocumentV2
except ImportError:
    from backend.contracts.transcript_document_v2 import TranscriptDocumentV2

from .contracts import (
    AnalysisJobResultV1,
    SilenceAnalysisJobInputV1,
    TimelineRecommendationV1,
    TranscriptAnalysisJobInputV1,
)
from .identity import result_identity

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


Input = SilenceAnalysisJobInputV1 | TranscriptAnalysisJobInputV1


class TranscriptAnalysisRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    @staticmethod
    async def _lock(connection: Any, context: JobExecutionContext, value: Input):
        async with connection.cursor() as cursor:
            await cursor.execute(
                "SELECT j.*,now() AS database_now FROM processing_jobs j WHERE id=%s FOR UPDATE",
                (context.job_id,),
            )
            job_row = await cursor.fetchone()
            if job_row is None:
                raise JobOrchestrationError("job_not_found", "Processing job was not found")
            job = dict(job_row)
            ProcessingJobLeaseRepository._validate_lease(
                job,
                worker_id=context.worker_id,
                claim_token=context.claim_token,
                allowed_statuses=frozenset({"claimed", "running"}),
            )
            await cursor.execute("SELECT * FROM media_assets WHERE id=%s FOR UPDATE", (value.mediaAssetId,))
            asset_row = await cursor.fetchone()
            await cursor.execute("SELECT * FROM transcripts WHERE id=%s FOR UPDATE", (value.transcriptId,))
            transcript_row = await cursor.fetchone()
            await cursor.execute("SELECT * FROM transcript_analyses WHERE id=%s FOR UPDATE", (value.analysisId,))
            analysis_row = await cursor.fetchone()
            variant_row = None
            if isinstance(value, SilenceAnalysisJobInputV1):
                await cursor.execute("SELECT * FROM media_variants WHERE id=%s FOR UPDATE", (value.audioVariantId,))
                variant_row = await cursor.fetchone()
        return (
            job,
            dict(asset_row) if asset_row else None,
            dict(transcript_row) if transcript_row else None,
            dict(analysis_row) if analysis_row else None,
            dict(variant_row) if variant_row else None,
        )

    @staticmethod
    def _validate(job, asset, transcript, analysis, variant, value: Input):
        if analysis is None:
            raise ProcessingJobFailure("analysis_not_found", "The analysis no longer exists", retryable=False)
        if asset is None or asset["deleted_at"] is not None:
            raise ProcessingJobFailure("media_asset_not_found", "The media asset no longer exists", retryable=False)
        if asset["revision"] != value.expectedMediaRevision:
            raise ProcessingJobFailure("media_revision_mismatch", "The media revision changed after planning", retryable=False)
        if transcript is None:
            raise ProcessingJobFailure("transcript_not_found", "The transcript no longer exists", retryable=False)
        if transcript["status"] != "ready" or transcript["deleted_at"] is not None:
            raise ProcessingJobFailure("transcript_not_ready", "The transcript is not ready", retryable=False)
        if transcript["revision"] != value.expectedTranscriptRevision:
            raise ProcessingJobFailure("transcript_revision_mismatch", "The transcript revision changed after planning", retryable=False)
        expected_type = "silence" if isinstance(value, SilenceAnalysisJobInputV1) else "transcript_review"
        if (
            job["job_type"] != value.jobType
            or job["owner_user_id"] != asset["owner_user_id"]
            or transcript["owner_user_id"] != asset["owner_user_id"]
            or transcript["media_asset_id"] != asset["id"]
            or analysis["owner_user_id"] != asset["owner_user_id"]
            or analysis["media_asset_id"] != asset["id"]
            or analysis["transcript_id"] != transcript["id"]
        ):
            raise ProcessingJobFailure("analysis_not_found", "The analysis is not authorized for this job", retryable=False)
        if (
            analysis["analysis_type"] != expected_type
            or analysis["analysis_spec_hash"] != value.analysisSpecHash
            or analysis["media_revision"] != value.expectedMediaRevision
            or analysis["transcript_revision"] != value.expectedTranscriptRevision
        ):
            raise ProcessingJobFailure("analysis_spec_mismatch", "The analysis identity changed", retryable=False)
        if isinstance(value, SilenceAnalysisJobInputV1):
            if variant is None:
                raise ProcessingJobFailure("audio_variant_missing", "The audio variant no longer exists", retryable=False)
            if (
                variant["media_asset_id"] != asset["id"]
                or variant["status"] != "ready"
                or variant["deleted_at"] is not None
                or variant["variant_type"] != "audio_extract"
                or variant["source_media_revision"] != asset["revision"]
                or variant["source_storage_object_revision"]
                != asset["storage_object_revision"]
                or not variant["storage_bucket"]
                or not variant["storage_path"]
            ):
                raise ProcessingJobFailure("audio_variant_not_ready", "The audio variant is not ready", retryable=False)
            if variant["revision"] != value.expectedAudioVariantRevision:
                raise ProcessingJobFailure("audio_variant_revision_mismatch", "The audio variant revision changed", retryable=False)
        try:
            document = TranscriptDocumentV2.model_validate(transcript["document"])
        except ValidationError as exc:
            raise ProcessingJobFailure("analysis_result_invalid", "The transcript contract is invalid", retryable=False) from exc
        return asset, transcript, analysis, variant, document

    async def begin(self, context: JobExecutionContext, value: Input):
        try:
            async with self.database.transaction() as connection:
                locked = await self._lock(connection, context, value)
                target = self._validate(*locked, value)
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """UPDATE transcript_analyses SET status='analyzing',failure=NULL,
                        revision=revision+1,updated_at=now() WHERE id=%s AND status<>'ready'""",
                        (value.analysisId,),
                    )
                return target
        except PersistenceError as exc:
            raise JobOrchestrationError("database_temporarily_unavailable", exc.message) from exc

    async def mark_normalizing(self, context: JobExecutionContext, value: Input) -> None:
        async with self.database.transaction() as connection:
            locked = await self._lock(connection, context, value)
            self._validate(*locked, value)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "UPDATE transcript_analyses SET status='normalizing',revision=revision+1,updated_at=now() WHERE id=%s AND status<>'ready'",
                    (value.analysisId,),
                )

    async def finalize_success(
        self,
        context: JobExecutionContext,
        value: Input,
        *,
        document: dict[str, Any],
        recommendations: list[TimelineRecommendationV1],
        result: AnalysisJobResultV1,
    ) -> dict[str, Any]:
        recommendation_json = [item.model_dump(mode="json") for item in recommendations]
        identity = result_identity(document, recommendation_json)
        if identity != result.resultIdentity:
            raise ProcessingJobFailure("analysis_result_invalid", "The analysis result identity is invalid", retryable=False)
        try:
            async with self.database.transaction() as connection:
                locked = await self._lock(connection, context, value)
                asset, transcript, analysis, _, transcript_document = self._validate(*locked, value)
                if analysis["status"] == "ready" and analysis["result_identity"] != identity:
                    raise ProcessingJobFailure("analysis_result_conflict", "A different analysis result is already ready", retryable=False)
                duration = transcript_document.durationMs
                word_ids = {word.id for word in transcript_document.words}
                segment_ids = {segment.id for segment in transcript_document.segments}
                findings = document.get("findings", [])
                for finding in findings:
                    if (
                        not set(finding.get("wordIds", [])) <= word_ids
                        or not set(finding.get("segmentIds", [])) <= segment_ids
                    ):
                        raise ProcessingJobFailure(
                            "analysis_result_invalid",
                            "An analysis finding has an invalid transcript reference",
                            retryable=False,
                        )
                for recommendation in recommendations:
                    if recommendation.analysisId != value.analysisId:
                        raise ProcessingJobFailure("recommendation_invalid", "Recommendation analysis identity is invalid", retryable=False)
                    if recommendation.sourceEndMs is not None and recommendation.sourceEndMs > duration:
                        raise ProcessingJobFailure("recommendation_invalid", "Recommendation exceeds media duration", retryable=False)
                    if (
                        not set(recommendation.wordIds) <= word_ids
                        or not set(recommendation.segmentIds) <= segment_ids
                    ):
                        raise ProcessingJobFailure(
                            "recommendation_invalid",
                            "A recommendation has an invalid transcript reference",
                            retryable=False,
                        )
                output = result.model_dump(mode="json")
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        "DELETE FROM timeline_recommendations WHERE analysis_id=%s AND status='proposed'",
                        (value.analysisId,),
                    )
                    for item, payload in zip(recommendations, recommendation_json):
                        await cursor.execute(
                            """INSERT INTO timeline_recommendations (
                            id,owner_user_id,analysis_id,media_asset_id,transcript_id,
                            recommendation_type,source_start_ms,source_end_ms,word_ids,
                            segment_ids,reason_code,severity,confidence,recommendation,status
                            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'proposed')""",
                            (
                                item.recommendationId, asset["owner_user_id"], value.analysisId,
                                asset["id"], transcript["id"], item.recommendationType,
                                item.sourceStartMs, item.sourceEndMs, _json(item.wordIds),
                                _json(item.segmentIds), item.reasonCode, item.severity,
                                item.analysisConfidence, _json(payload),
                            ),
                        )
                    await cursor.execute(
                        """UPDATE transcript_analyses SET status='ready',document=%s,summary=%s,
                        failure=NULL,result_identity=%s,ready_at=COALESCE(ready_at,now()),
                        revision=CASE WHEN result_identity=%s THEN revision ELSE revision+1 END,
                        updated_at=now() WHERE id=%s""",
                        (_json(document), _json(document["summary"]), identity, identity, value.analysisId),
                    )
                    await cursor.execute(
                        """UPDATE processing_jobs SET status='succeeded',progress=100,output=%s,
                        error=NULL,failure_code=NULL,failure_message=NULL,finished_at=now(),
                        worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,current_stage='completed',
                        revision=revision+1,updated_at=now() WHERE id=%s""",
                        (_json(output), context.job_id),
                    )
                    if cursor.rowcount != 1:
                        raise JobOrchestrationError("job_lease_lost", "The analysis job changed before finalization")
                    await cursor.execute(
                        """UPDATE processing_job_attempts SET status='succeeded',finished_at=now(),
                        lease_expires_at=NULL,output_summary=%s WHERE job_id=%s AND attempt_number=%s""",
                        (_json({"analysisId": value.analysisId, "resultIdentity": identity}), context.job_id, context.attempt_number),
                    )
                    if cursor.rowcount != 1:
                        raise JobOrchestrationError("job_lease_lost", "The analysis attempt changed before finalization")
                return output
        except PersistenceError as exc:
            raise JobOrchestrationError("database_temporarily_unavailable", exc.message) from exc

    async def finalize_permanent_failure(self, context, value: Input, failure: ProcessingJobFailure) -> None:
        safe = JobFailure(failure.code, failure.safe_message, False, {}).as_dict()
        async with self.database.transaction() as connection:
            locked = await self._lock(connection, context, value)
            job, _, _, analysis, _ = locked
            if analysis is None or job["job_type"] != value.jobType:
                raise ProcessingJobFailure("analysis_not_found", "The analysis is unavailable", retryable=False)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "UPDATE transcript_analyses SET status='failed',failure=%s,revision=revision+1,updated_at=now() WHERE id=%s AND status NOT IN ('ready','deleted')",
                    (_json(safe), value.analysisId),
                )
                await cursor.execute(
                    """UPDATE processing_jobs SET status='failed',error=%s,failure_code=%s,
                    failure_message=%s,finished_at=now(),worker_id=NULL,claim_token=NULL,
                    lease_expires_at=NULL,next_retry_at=NULL,current_stage='failed',
                    revision=revision+1,updated_at=now() WHERE id=%s""",
                    (_json(safe), failure.code[:100], failure.safe_message[:1000], context.job_id),
                )
                await cursor.execute(
                    "UPDATE processing_job_attempts SET status='failed',finished_at=now(),lease_expires_at=NULL,error=%s WHERE job_id=%s AND attempt_number=%s",
                    (_json(safe), context.job_id, context.attempt_number),
                )

    async def release_after_cancellation(self, context, value: Input) -> None:
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT *,now() AS database_now FROM processing_jobs WHERE id=%s FOR UPDATE", (context.job_id,))
                row = await cursor.fetchone()
                if row is None:
                    return
                ProcessingJobLeaseRepository._validate_lease(
                    dict(row), worker_id=context.worker_id, claim_token=context.claim_token,
                    allowed_statuses=frozenset({"cancel_requested", "running"}),
                )
                await cursor.execute(
                    "UPDATE transcript_analyses SET status='queued',revision=revision+1,updated_at=now() WHERE id=%s AND status IN ('analyzing','normalizing')",
                    (value.analysisId,),
                )


__all__ = ["TranscriptAnalysisRepository"]
