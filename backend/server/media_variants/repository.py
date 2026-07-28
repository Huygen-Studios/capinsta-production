from __future__ import annotations

import hashlib
import json
from typing import Any

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext, JobFailure
from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError

from .contracts import MediaVariantJobInputV1, VariantResultV1
from .presets import JOB_TO_VARIANT

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


def result_identity(result: dict[str, Any]) -> str:
    serialized = json.dumps(
        result, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _database_failure(exc: PersistenceError) -> JobOrchestrationError:
    return JobOrchestrationError(
        "database_temporarily_unavailable", exc.message
    )


class MediaVariantRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    @staticmethod
    async def _locked_target(
        connection: Any,
        context: JobExecutionContext,
        job_input: MediaVariantJobInputV1,
    ) -> tuple[dict[str, Any], dict[str, Any] | None, dict[str, Any] | None]:
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
                (job_input.variantId,),
            )
            variant_row = await cursor.fetchone()
        return (
            job,
            dict(asset_row) if asset_row is not None else None,
            dict(variant_row) if variant_row is not None else None,
        )

    @staticmethod
    def _validate(
        job: dict[str, Any],
        asset: dict[str, Any] | None,
        variant: dict[str, Any] | None,
        job_input: MediaVariantJobInputV1,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if asset is None:
            raise ProcessingJobFailure(
                "media_asset_not_found",
                "The media asset no longer exists",
                retryable=False,
            )
        if variant is None:
            raise ProcessingJobFailure(
                "variant_not_found",
                "The media variant no longer exists",
                retryable=False,
            )
        if (
            job["owner_user_id"] != asset["owner_user_id"]
            or job["media_asset_id"] != asset["id"]
            or variant["media_asset_id"] != asset["id"]
        ):
            raise ProcessingJobFailure(
                "variant_not_found",
                "The media variant is not authorized for this job",
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
                "source_media_not_ready",
                "The source media has not completed probing",
                retryable=False,
            )
        if asset["revision"] != job_input.expectedMediaRevision:
            raise ProcessingJobFailure(
                "variant_source_revision_mismatch",
                "The source media revision changed after planning",
                retryable=False,
            )
        if asset["storage_object_revision"] != job_input.storageObjectRevision:
            raise ProcessingJobFailure(
                "variant_storage_revision_mismatch",
                "The source object revision changed after planning",
                retryable=False,
            )
        if (
            variant["source_media_revision"] != job_input.expectedMediaRevision
            or variant["source_storage_object_revision"]
            != job_input.storageObjectRevision
        ):
            raise ProcessingJobFailure(
                "variant_source_revision_mismatch",
                "The variant targets a different source revision",
                retryable=False,
            )
        if variant["generation_spec_hash"] != job_input.generationSpecHash:
            raise ProcessingJobFailure(
                "variant_spec_mismatch",
                "The variant generation specification changed after planning",
                retryable=False,
            )
        if variant["variant_type"] != JOB_TO_VARIANT.get(job["job_type"]):
            raise ProcessingJobFailure(
                "variant_spec_mismatch",
                "The variant type does not match the processing job",
                retryable=False,
            )
        if variant["deleted_at"] is not None or variant["status"] in {
            "deleted",
            "deletion_pending",
        }:
            raise ProcessingJobFailure(
                "variant_not_found",
                "The media variant was deleted",
                retryable=False,
            )
        if not asset["storage_bucket"] or not asset["storage_path"]:
            raise ProcessingJobFailure(
                "source_media_not_ready",
                "The source media has no verified storage object",
                retryable=True,
            )
        return asset, variant

    async def begin(
        self,
        context: JobExecutionContext,
        job_input: MediaVariantJobInputV1,
    ) -> dict[str, Any]:
        try:
            async with self.database.transaction() as connection:
                job, asset, variant = await self._locked_target(
                    connection, context, job_input
                )
                target, variant_target = self._validate(
                    job, asset, variant, job_input
                )
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        SELECT output FROM processing_jobs
                        WHERE media_asset_id=%s AND job_type='media_probe'
                          AND status='succeeded'
                          AND (output->>'mediaAssetRevision')::bigint=%s
                        ORDER BY finished_at DESC,id DESC LIMIT 1
                        """,
                        (target["id"], target["revision"]),
                    )
                    probe_row = await cursor.fetchone()
                    if probe_row is None:
                        raise ProcessingJobFailure(
                            "source_media_not_ready",
                            "The normalized probe result is unavailable",
                            retryable=False,
                        )
                    if variant_target["status"] != "ready":
                        await cursor.execute(
                            """
                            UPDATE media_variants SET status='processing',
                              failure=NULL,revision=revision+1,updated_at=now()
                            WHERE id=%s
                            """,
                            (variant_target["id"],),
                        )
                result = dict(target)
                result["probe_output"] = probe_row["output"]
                result["variant"] = variant_target
                return result
        except PersistenceError as exc:
            raise _database_failure(exc) from exc

    async def mark_stage(
        self,
        context: JobExecutionContext,
        job_input: MediaVariantJobInputV1,
        status: str,
    ) -> None:
        if status not in {"uploading", "verifying"}:
            raise ValueError("unsupported media-variant stage")
        try:
            async with self.database.transaction() as connection:
                job, asset, variant = await self._locked_target(
                    connection, context, job_input
                )
                self._validate(job, asset, variant, job_input)
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE media_variants SET status=%s,
                          revision=revision+1,updated_at=now() WHERE id=%s
                        """,
                        (status, job_input.variantId),
                    )
        except PersistenceError as exc:
            raise _database_failure(exc) from exc

    async def finalize_success(
        self,
        context: JobExecutionContext,
        job_input: MediaVariantJobInputV1,
        result: VariantResultV1,
    ) -> dict[str, Any]:
        output = result.model_dump(mode="json")
        identity = result_identity(output)
        try:
            async with self.database.transaction() as connection:
                job, asset, variant = await self._locked_target(
                    connection, context, job_input
                )
                _, target = self._validate(job, asset, variant, job_input)
                metadata = dict(target["metadata"] or {})
                metadata["technical"] = output["technicalMetadata"]
                metadata["warnings"] = output["warnings"]
                metadata["checksum"] = output["checksum"]
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE media_variants SET
                          mime_type=%s,width=%s,height=%s,duration_ms=%s,
                          size_bytes=%s,storage_bucket=%s,storage_path=%s,
                          status='ready',metadata=%s,result_identity=%s,
                          failure=NULL,ready_at=now(),revision=revision+1,
                          updated_at=now()
                        WHERE id=%s AND source_media_revision=%s
                          AND source_storage_object_revision=%s
                          AND generation_spec_hash=%s
                        """,
                        (
                            result.mimeType,
                            result.width,
                            result.height,
                            result.durationMs,
                            result.sizeBytes,
                            result.storageBucket,
                            result.storagePath,
                            _json(metadata),
                            identity,
                            target["id"],
                            job_input.expectedMediaRevision,
                            job_input.storageObjectRevision,
                            job_input.generationSpecHash,
                        ),
                    )
                    if cursor.rowcount != 1:
                        raise ProcessingJobFailure(
                            "variant_source_revision_mismatch",
                            "The source changed before variant finalization",
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
                                    "mediaVariantId": str(result.mediaVariantId),
                                    "resultIdentity": identity,
                                }
                            ),
                            context.job_id,
                            context.attempt_number,
                        ),
                    )
                return output
        except PersistenceError as exc:
            raise _database_failure(exc) from exc

    async def finalize_permanent_failure(
        self,
        context: JobExecutionContext,
        job_input: MediaVariantJobInputV1,
        failure: ProcessingJobFailure,
    ) -> None:
        safe = JobFailure(
            failure.code, failure.safe_message, False, {}
        ).as_dict()
        try:
            async with self.database.transaction() as connection:
                job, asset, variant = await self._locked_target(
                    connection, context, job_input
                )
                _, target = self._validate(job, asset, variant, job_input)
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE media_variants SET status='failed',failure=%s,
                          revision=revision+1,updated_at=now() WHERE id=%s
                        """,
                        (_json(safe), target["id"]),
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
        except PersistenceError as exc:
            raise _database_failure(exc) from exc

    async def release_after_cancellation(
        self,
        context: JobExecutionContext,
        job_input: MediaVariantJobInputV1,
    ) -> None:
        try:
            async with self.database.transaction() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        SELECT j.*,now() AS database_now FROM processing_jobs j
                        WHERE id=%s FOR UPDATE
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
                        UPDATE media_variants SET status='queued',
                          revision=revision+1,updated_at=now()
                        WHERE id=%s AND status IN
                          ('processing','uploading','verifying')
                        """,
                        (job_input.variantId,),
                    )
        except PersistenceError as exc:
            raise _database_failure(exc) from exc


__all__ = ["MediaVariantRepository", "result_identity"]
