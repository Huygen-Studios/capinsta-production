from __future__ import annotations

from typing import Any

from server.clipping_jobs.errors import (
    JobOrchestrationError,
    ProcessingJobFailure,
)
from server.clipping_jobs.models import JobExecutionContext, JobFailure
from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError

from .contracts import TranscriptionJobInputV1, TranscriptionJobResultV1
from .identity import transcript_result_identity

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


def _database_failure(exc: PersistenceError) -> JobOrchestrationError:
    return JobOrchestrationError(
        "database_temporarily_unavailable", exc.message
    )


class DurableTranscriptionRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    @staticmethod
    async def _locked_target(
        connection: Any,
        context: JobExecutionContext,
        job_input: TranscriptionJobInputV1,
    ) -> tuple[
        dict[str, Any],
        dict[str, Any] | None,
        dict[str, Any] | None,
        dict[str, Any] | None,
    ]:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                SELECT j.*,now() AS database_now
                FROM processing_jobs j WHERE j.id=%s FOR UPDATE
                """,
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
                "SELECT * FROM media_assets WHERE id=%s FOR UPDATE",
                (job_input.mediaAssetId,),
            )
            asset_row = await cursor.fetchone()
            await cursor.execute(
                "SELECT * FROM media_variants WHERE id=%s FOR UPDATE",
                (job_input.audioVariantId,),
            )
            variant_row = await cursor.fetchone()
            await cursor.execute(
                "SELECT * FROM transcripts WHERE id=%s FOR UPDATE",
                (job_input.transcriptId,),
            )
            transcript_row = await cursor.fetchone()
        return (
            job,
            dict(asset_row) if asset_row else None,
            dict(variant_row) if variant_row else None,
            dict(transcript_row) if transcript_row else None,
        )

    @staticmethod
    def _validate(
        job: dict[str, Any],
        asset: dict[str, Any] | None,
        variant: dict[str, Any] | None,
        transcript: dict[str, Any] | None,
        job_input: TranscriptionJobInputV1,
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        if asset is None:
            raise ProcessingJobFailure(
                "media_asset_not_found",
                "The media asset no longer exists",
                retryable=False,
            )
        if asset["deleted_at"] is not None or asset["status"] in {
            "deleted",
            "deletion_pending",
        }:
            raise ProcessingJobFailure(
                "media_asset_deleted",
                "The media asset has been deleted",
                retryable=False,
            )
        if asset["status"] != "ready":
            raise ProcessingJobFailure(
                "transcription_source_not_ready",
                "The media asset has not completed probing",
                retryable=False,
            )
        if asset["revision"] != job_input.expectedMediaRevision:
            raise ProcessingJobFailure(
                "transcription_media_revision_mismatch",
                "The media revision changed after transcription planning",
                retryable=False,
            )
        if asset["storage_object_revision"] != job_input.storageObjectRevision:
            raise ProcessingJobFailure(
                "transcription_storage_revision_mismatch",
                "The source object changed after transcription planning",
                retryable=False,
            )
        if variant is None:
            raise ProcessingJobFailure(
                "transcription_audio_variant_missing",
                "The transcription audio variant no longer exists",
                retryable=False,
            )
        generation_spec = variant.get("generation_spec") or {}
        if (
            variant["media_asset_id"] != asset["id"]
            or variant["variant_type"] != "audio_extract"
            or generation_spec.get("preset")
            != "transcription-wav-16k-mono-v1"
        ):
            raise ProcessingJobFailure(
                "transcription_audio_variant_invalid",
                "The audio variant is not the supported transcription preset",
                retryable=False,
            )
        if (
            variant["status"] != "ready"
            or variant["deleted_at"] is not None
            or not variant["storage_bucket"]
            or not variant["storage_path"]
        ):
            raise ProcessingJobFailure(
                "transcription_audio_variant_not_ready",
                "The transcription audio variant is not ready",
                retryable=False,
            )
        if (
            variant["source_media_revision"]
            != job_input.expectedMediaRevision
            or variant["source_storage_object_revision"]
            != job_input.storageObjectRevision
            or variant["revision"] != job_input.audioVariantRevision
        ):
            raise ProcessingJobFailure(
                "transcription_audio_variant_stale",
                "The transcription audio variant changed after planning",
                retryable=False,
            )
        if transcript is None:
            raise ProcessingJobFailure(
                "transcript_not_found",
                "The durable transcript request no longer exists",
                retryable=False,
            )
        if (
            job["job_type"] != "transcription"
            or job["owner_user_id"] != asset["owner_user_id"]
            or job["media_asset_id"] != asset["id"]
            or transcript["owner_user_id"] != asset["owner_user_id"]
            or transcript["media_asset_id"] != asset["id"]
        ):
            raise ProcessingJobFailure(
                "transcript_not_found",
                "The transcript is not authorized for this job",
                retryable=False,
            )
        if transcript["deleted_at"] is not None or transcript["status"] == "deleted":
            raise ProcessingJobFailure(
                "transcript_deleted",
                "The transcript request was deleted",
                retryable=False,
            )
        if (
            transcript["request_identity"] != job_input.requestIdentity
            or transcript["media_revision"]
            != job_input.expectedMediaRevision
            or transcript["storage_object_revision"]
            != job_input.storageObjectRevision
            or transcript["audio_variant_id"] != job_input.audioVariantId
            or transcript["audio_variant_revision"]
            != job_input.audioVariantRevision
        ):
            raise ProcessingJobFailure(
                "transcript_request_identity_mismatch",
                "The transcript request identity changed",
                retryable=False,
            )
        return asset, variant, transcript

    async def begin(
        self,
        context: JobExecutionContext,
        job_input: TranscriptionJobInputV1,
    ) -> dict[str, Any]:
        try:
            async with self.database.transaction() as connection:
                job, asset, variant, transcript = await self._locked_target(
                    connection, context, job_input
                )
                target, audio, request = self._validate(
                    job, asset, variant, transcript, job_input
                )
                if request["status"] != "ready":
                    async with connection.cursor() as cursor:
                        await cursor.execute(
                            """
                            UPDATE transcripts SET status='transcribing',
                              failure=NULL,revision=revision+1,updated_at=now()
                            WHERE id=%s
                            """,
                            (request["id"],),
                        )
                return {
                    "asset": target,
                    "variant": audio,
                    "transcript": request,
                    "existingDocument": (
                        request["document"]
                        if request["status"] == "ready"
                        else None
                    ),
                }
        except PersistenceError as exc:
            raise _database_failure(exc) from exc

    async def mark_normalizing(
        self,
        context: JobExecutionContext,
        job_input: TranscriptionJobInputV1,
    ) -> None:
        try:
            async with self.database.transaction() as connection:
                job, asset, variant, transcript = await self._locked_target(
                    connection, context, job_input
                )
                self._validate(job, asset, variant, transcript, job_input)
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE transcripts SET status='normalizing',
                          revision=revision+1,updated_at=now()
                        WHERE id=%s AND status<>'ready'
                        """,
                        (job_input.transcriptId,),
                    )
        except PersistenceError as exc:
            raise _database_failure(exc) from exc

    async def finalize_success(
        self,
        context: JobExecutionContext,
        job_input: TranscriptionJobInputV1,
        *,
        document: dict[str, Any],
        result: TranscriptionJobResultV1,
    ) -> dict[str, Any]:
        output = result.model_dump(mode="json")
        identity = transcript_result_identity(document)
        if identity != result.resultIdentity:
            raise ProcessingJobFailure(
                "transcript_result_identity_mismatch",
                "The transcript result identity is invalid",
                retryable=False,
            )
        try:
            async with self.database.transaction() as connection:
                job, asset, variant, transcript = await self._locked_target(
                    connection, context, job_input
                )
                _, _, target = self._validate(
                    job, asset, variant, transcript, job_input
                )
                if (
                    target["status"] == "ready"
                    and target["result_identity"] != identity
                ):
                    raise ProcessingJobFailure(
                        "transcript_result_conflict",
                        "A different transcript result is already ready",
                        retryable=False,
                    )
                provider = document["provider"]
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE transcripts SET provider_name=%s,
                          provider_model=%s,language_mode=%s,duration_ms=%s,
                          status='ready',document=%s,quality=%s,metadata=%s,
                          result_identity=%s,failure=NULL,
                          ready_at=COALESCE(ready_at,now()),
                          revision=CASE WHEN result_identity=%s
                            THEN revision ELSE revision+1 END,
                          updated_at=now()
                        WHERE id=%s AND request_identity=%s
                        """,
                        (
                            provider["name"],
                            provider.get("model"),
                            document["languageMode"],
                            document["durationMs"],
                            _json(document),
                            _json(document["quality"]),
                            _json(document["metadata"]),
                            identity,
                            identity,
                            job_input.transcriptId,
                            job_input.requestIdentity,
                        ),
                    )
                    if cursor.rowcount != 1:
                        raise ProcessingJobFailure(
                            "transcript_request_identity_mismatch",
                            "The transcript request changed before finalization",
                            retryable=False,
                        )
                    await cursor.execute(
                        """
                        UPDATE processing_jobs SET status='succeeded',
                          progress=100,output=%s,error=NULL,failure_code=NULL,
                          failure_message=NULL,finished_at=now(),worker_id=NULL,
                          claim_token=NULL,lease_expires_at=NULL,
                          current_stage='completed',revision=revision+1,
                          updated_at=now() WHERE id=%s
                        """,
                        (_json(output), context.job_id),
                    )
                    if cursor.rowcount != 1:
                        raise JobOrchestrationError(
                            "job_lease_lost",
                            "The transcription job changed before finalization",
                        )
                    await cursor.execute(
                        """
                        UPDATE processing_job_attempts SET status='succeeded',
                          finished_at=now(),lease_expires_at=NULL,
                          output_summary=%s
                        WHERE job_id=%s AND attempt_number=%s
                        """,
                        (
                            _json(
                                {
                                    "transcriptId": job_input.transcriptId,
                                    "resultIdentity": identity,
                                }
                            ),
                            context.job_id,
                            context.attempt_number,
                        ),
                    )
                    if cursor.rowcount != 1:
                        raise JobOrchestrationError(
                            "job_lease_lost",
                            "The transcription attempt changed before finalization",
                        )
                return output
        except PersistenceError as exc:
            raise _database_failure(exc) from exc

    async def finalize_permanent_failure(
        self,
        context: JobExecutionContext,
        job_input: TranscriptionJobInputV1,
        failure: ProcessingJobFailure,
    ) -> None:
        safe = JobFailure(
            failure.code, failure.safe_message, False, {}
        ).as_dict()
        try:
            async with self.database.transaction() as connection:
                job, asset, variant, transcript = await self._locked_target(
                    connection, context, job_input
                )
                del asset, variant
                if (
                    job["job_type"] != "transcription"
                    or job["media_asset_id"] != job_input.mediaAssetId
                    or (
                        transcript is not None
                        and (
                            transcript["owner_user_id"]
                            != job["owner_user_id"]
                            or transcript["media_asset_id"]
                            != job_input.mediaAssetId
                            or transcript["request_identity"]
                            != job_input.requestIdentity
                        )
                    )
                ):
                    raise ProcessingJobFailure(
                        "transcript_not_found",
                        "The transcript is not authorized for this job",
                        retryable=False,
                    )
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE transcripts SET status='failed',failure=%s,
                          revision=revision+1,updated_at=now()
                        WHERE id=%s AND request_identity=%s
                          AND status NOT IN ('ready','deleted')
                        """,
                        (
                            _json(safe),
                            job_input.transcriptId,
                            job_input.requestIdentity,
                        ),
                    )
                    await cursor.execute(
                        """
                        UPDATE processing_jobs SET status='failed',error=%s,
                          failure_code=%s,failure_message=%s,finished_at=now(),
                          worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,
                          next_retry_at=NULL,current_stage='failed',
                          revision=revision+1,updated_at=now() WHERE id=%s
                        """,
                        (
                            _json(safe),
                            failure.code[:100],
                            failure.safe_message[:1000],
                            context.job_id,
                        ),
                    )
                    if cursor.rowcount != 1:
                        raise JobOrchestrationError(
                            "job_lease_lost",
                            "The transcription job changed before failure finalization",
                        )
                    await cursor.execute(
                        """
                        UPDATE processing_job_attempts SET status='failed',
                          finished_at=now(),lease_expires_at=NULL,error=%s
                        WHERE job_id=%s AND attempt_number=%s
                        """,
                        (
                            _json(safe),
                            context.job_id,
                            context.attempt_number,
                        ),
                    )
                    if cursor.rowcount != 1:
                        raise JobOrchestrationError(
                            "job_lease_lost",
                            "The transcription attempt changed before failure finalization",
                        )
        except PersistenceError as exc:
            raise _database_failure(exc) from exc

    async def release_after_cancellation(
        self,
        context: JobExecutionContext,
        job_input: TranscriptionJobInputV1,
    ) -> None:
        try:
            async with self.database.transaction() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        SELECT j.*,now() AS database_now
                        FROM processing_jobs j WHERE id=%s FOR UPDATE
                        """,
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
                        """
                        UPDATE transcripts SET status='queued',
                          revision=revision+1,updated_at=now()
                        WHERE id=%s AND status IN
                          ('transcribing','normalizing')
                        """,
                        (job_input.transcriptId,),
                    )
        except PersistenceError as exc:
            raise _database_failure(exc) from exc


__all__ = ["DurableTranscriptionRepository"]
