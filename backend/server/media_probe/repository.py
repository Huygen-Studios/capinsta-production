from __future__ import annotations

import hashlib
import json
import os
from typing import Any

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext, JobFailure
from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError

from .contracts import MediaProbeJobInputV1, MediaProbeResultV1

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


def _result_identity(output: dict[str, Any]) -> str:
    serialized = json.dumps(
        output, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _probe_metadata(
    result: MediaProbeResultV1, *, storage_revision: int
) -> dict[str, Any]:
    video = result.video
    audio = result.audio
    return {
        "schemaVersion": 1,
        "containerFormat": result.container.formatName,
        "containerLongName": result.container.formatLongName,
        "videoCodec": video.codecName if video else None,
        "audioCodec": audio.codecName if audio else None,
        "encodedWidth": video.encodedWidth if video else None,
        "encodedHeight": video.encodedHeight if video else None,
        "codedWidth": video.codedWidth if video else None,
        "codedHeight": video.codedHeight if video else None,
        "rotationDegrees": video.rotationDegrees if video else 0,
        "sampleRateHz": audio.sampleRateHz if audio else None,
        "channels": audio.channels if audio else None,
        "channelLayout": audio.channelLayout if audio else None,
        "pixelFormat": video.pixelFormat if video else None,
        "bitRate": result.container.bitRate,
        "streamCount": result.streamCount,
        "probedStorageRevision": storage_revision,
        "warnings": result.warnings,
    }


class MediaProbeRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    async def _before_job_completion(
        self, connection: Any, output: dict[str, Any]
    ) -> None:
        """Test seam inside the atomic asset/job transaction."""
        del connection, output

    @staticmethod
    async def _locked_job_and_asset(
        connection: Any,
        context: JobExecutionContext,
        job_input: MediaProbeJobInputV1,
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                SELECT j.*,now() AS database_now
                FROM processing_jobs j
                WHERE j.id=%s
                FOR UPDATE
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
        return job, dict(asset_row) if asset_row is not None else None

    @staticmethod
    def _validate_target(
        job: dict[str, Any],
        asset: dict[str, Any] | None,
        job_input: MediaProbeJobInputV1,
        *,
        allow_probing: bool = True,
    ) -> dict[str, Any]:
        if asset is None:
            raise ProcessingJobFailure(
                "media_asset_not_found",
                "The media asset no longer exists",
                retryable=False,
            )
        if (
            job["media_asset_id"] != asset["id"]
            or job["owner_user_id"] != asset["owner_user_id"]
            or str(job_input.mediaAssetId) != str(asset["id"])
        ):
            raise ProcessingJobFailure(
                "media_asset_not_found",
                "The media asset is not authorized for this job",
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
        if asset["revision"] != job_input.expectedMediaRevision:
            raise ProcessingJobFailure(
                "media_asset_revision_mismatch",
                "The media asset was replaced after this probe was queued",
                retryable=False,
            )
        if asset["storage_object_revision"] != job_input.storageObjectRevision:
            raise ProcessingJobFailure(
                "storage_object_revision_mismatch",
                "The stored object was replaced after this probe was queued",
                retryable=False,
            )
        statuses = {"ready_for_probe"}
        if allow_probing:
            statuses.add("probing")
        if asset["status"] not in statuses:
            raise ProcessingJobFailure(
                "media_asset_not_ready_for_probe",
                "The media asset is not ready for probing",
                retryable=False,
            )
        if not asset["storage_bucket"] or not asset["storage_path"]:
            raise ProcessingJobFailure(
                "probe_source_unavailable",
                "The media asset has no verified storage object",
                retryable=True,
            )
        return asset

    async def begin_probe(
        self,
        context: JobExecutionContext,
        job_input: MediaProbeJobInputV1,
    ) -> dict[str, Any]:
        try:
            async with self.database.transaction() as connection:
                job, asset = await self._locked_job_and_asset(
                    connection, context, job_input
                )
                target = self._validate_target(job, asset, job_input)
                if target["status"] == "ready_for_probe":
                    async with connection.cursor() as cursor:
                        await cursor.execute(
                            """
                            UPDATE media_assets
                            SET status='probing',updated_at=now()
                            WHERE id=%s
                            RETURNING *
                            """,
                            (target["id"],),
                        )
                        target = dict(await cursor.fetchone())
                return target
        except PersistenceError as exc:
            raise _database_failure(exc) from exc

    async def finalize_success(
        self,
        context: JobExecutionContext,
        job_input: MediaProbeJobInputV1,
        result: MediaProbeResultV1,
    ) -> dict[str, Any]:
        output = result.model_dump(mode="json")
        identity = _result_identity(output)
        try:
            async with self.database.transaction() as connection:
                job, asset = await self._locked_job_and_asset(
                    connection, context, job_input
                )
                target = self._validate_target(job, asset, job_input)
                if target["status"] != "probing":
                    raise ProcessingJobFailure(
                        "media_probe_result_conflict",
                        "The media asset is not in the probing state",
                        retryable=False,
                    )
                metadata = dict(target["metadata"] or {})
                metadata.pop("probeFailure", None)
                metadata["probe"] = _probe_metadata(
                    result,
                    storage_revision=job_input.storageObjectRevision,
                )
                video = result.video
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE media_assets SET
                          media_kind=%s,duration_ms=%s,width=%s,height=%s,
                          fps_numerator=%s,fps_denominator=%s,status='ready',
                          metadata=%s,probe_result_identity=%s,
                          revision=revision+1,updated_at=now()
                        WHERE id=%s AND revision=%s
                          AND storage_object_revision=%s
                        RETURNING *
                        """,
                        (
                            result.mediaKind,
                            result.durationMs,
                            video.width if video else None,
                            video.height if video else None,
                            video.fpsNumerator if video else None,
                            video.fpsDenominator if video else None,
                            _json(metadata),
                            identity,
                            target["id"],
                            job_input.expectedMediaRevision,
                            job_input.storageObjectRevision,
                        ),
                    )
                    asset_update = await cursor.fetchone()
                    if asset_update is None:
                        raise ProcessingJobFailure(
                            "media_probe_result_conflict",
                            "The media asset changed before probe completion",
                            retryable=False,
                        )
                    if asset_update["revision"] != result.mediaAssetRevision:
                        raise ProcessingJobFailure(
                            "media_probe_result_conflict",
                            "The probe result revision is inconsistent",
                            retryable=False,
                        )
                    if (
                        os.getenv("ENABLE_MEDIA_VARIANT_PLANNING", "")
                        .strip()
                        .lower()
                        in {"1", "true", "yes", "on"}
                    ):
                        from server.media_variants.planning import (
                            MediaVariantPlanningService,
                        )

                        await MediaVariantPlanningService.plan_in_transaction(
                            connection,
                            asset=dict(asset_update),
                            probe_result=output,
                        )
                    await self._before_job_completion(connection, output)
                    await cursor.execute(
                        """
                        UPDATE processing_jobs SET status='succeeded',progress=100,
                          output=%s,error=NULL,failure_code=NULL,
                          failure_message=NULL,finished_at=now(),
                          worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,
                          current_stage='completed',revision=revision+1,
                          updated_at=now()
                        WHERE id=%s
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
                                    "keys": sorted(output)[:50],
                                    "mediaProbeResultIdentity": identity,
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
        job_input: MediaProbeJobInputV1,
        failure: ProcessingJobFailure,
    ) -> None:
        safe_failure = JobFailure(
            code=failure.code,
            message=failure.safe_message,
            retryable=False,
            details={},
        ).as_dict()
        try:
            async with self.database.transaction() as connection:
                job, asset = await self._locked_job_and_asset(
                    connection, context, job_input
                )
                target = self._validate_target(job, asset, job_input)
                metadata = dict(target["metadata"] or {})
                metadata["probeFailure"] = {
                    "schemaVersion": 1,
                    "code": failure.code[:100],
                    "message": failure.safe_message[:300],
                    "storageObjectRevision": job_input.storageObjectRevision,
                }
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE media_assets SET status='probe_failed',
                          metadata=%s,probe_result_identity=NULL,
                          revision=revision+1,updated_at=now()
                        WHERE id=%s AND revision=%s
                          AND storage_object_revision=%s
                        """,
                        (
                            _json(metadata),
                            target["id"],
                            job_input.expectedMediaRevision,
                            job_input.storageObjectRevision,
                        ),
                    )
                    if cursor.rowcount != 1:
                        raise ProcessingJobFailure(
                            "media_probe_result_conflict",
                            "The media asset changed before failure persistence",
                            retryable=False,
                        )
                    await cursor.execute(
                        """
                        UPDATE processing_jobs SET status='failed',error=%s,
                          failure_code=%s,failure_message=%s,finished_at=now(),
                          worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,
                          next_retry_at=NULL,current_stage='failed',
                          revision=revision+1,updated_at=now()
                        WHERE id=%s
                        """,
                        (
                            _json(safe_failure),
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
                            _json(safe_failure),
                            context.job_id,
                            context.attempt_number,
                        ),
                    )
        except PersistenceError as exc:
            raise _database_failure(exc) from exc

    async def release_after_cancellation(
        self,
        context: JobExecutionContext,
        job_input: MediaProbeJobInputV1,
    ) -> None:
        try:
            async with self.database.transaction() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        SELECT j.*,now() AS database_now
                        FROM processing_jobs j WHERE j.id=%s FOR UPDATE
                        """,
                        (context.job_id,),
                    )
                    row = await cursor.fetchone()
                    if row is None:
                        return
                    job = dict(row)
                    ProcessingJobLeaseRepository._validate_lease(
                        job,
                        worker_id=context.worker_id,
                        claim_token=context.claim_token,
                        allowed_statuses=frozenset({"cancel_requested"}),
                    )
                    await cursor.execute(
                        """
                        UPDATE media_assets SET status='ready_for_probe',
                          updated_at=now()
                        WHERE id=%s AND revision=%s
                          AND storage_object_revision=%s
                          AND status='probing'
                        """,
                        (
                            job_input.mediaAssetId,
                            job_input.expectedMediaRevision,
                            job_input.storageObjectRevision,
                        ),
                    )
        except PersistenceError as exc:
            raise _database_failure(exc) from exc


__all__ = ["MediaProbeRepository"]
