from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_orchestration.config import ClippingOrchestrationConfig
from server.clipping_orchestration.contracts import CanvasInput, CreateProjectRequest
from server.clipping_orchestration.repository import ClippingOrchestrationRepository
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.models import AuthenticatedActor
from server.durable_transcription.planning import TranscriptionPlanningService
from server.transcript_analysis.planning import TranscriptAnalysisPlanningService

from .repository import AutomaticClipperRepository
from .session_service import ClipperSessionService

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


class AutomaticClipperWorkflowService:
    """Idempotently advances Stage 2/3 planners; manages durable session lifecycle."""

    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    async def _snapshot(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> dict[str, Any]:
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT * FROM media_assets WHERE id=%s
                    AND owner_user_id=%s AND deleted_at IS NULL""",
                    (media_asset_id, actor.user_id),
                )
                asset_row = await cursor.fetchone()
                if asset_row is None:
                    return {"notFound": True}
                asset = dict(asset_row)
                await cursor.execute(
                    """SELECT * FROM transcripts WHERE media_asset_id=%s
                    AND owner_user_id=%s AND deleted_at IS NULL
                    ORDER BY created_at DESC LIMIT 1""",
                    (media_asset_id, actor.user_id),
                )
                transcript_row = await cursor.fetchone()
                transcript = dict(transcript_row) if transcript_row else None
                await cursor.execute(
                    """SELECT * FROM clip_projects WHERE source_media_asset_id=%s
                    AND owner_user_id=%s AND deleted_at IS NULL
                    ORDER BY created_at DESC LIMIT 1""",
                    (media_asset_id, actor.user_id),
                )
                project_row = await cursor.fetchone()
                project = dict(project_row) if project_row else None
                await cursor.execute(
                    """SELECT id,job_type,status,progress,current_stage,
                    failure_code,failure_message,created_at,updated_at
                    FROM processing_jobs WHERE media_asset_id=%s
                    AND owner_user_id=%s ORDER BY created_at DESC""",
                    (media_asset_id, actor.user_id),
                )
                jobs = [dict(row) for row in await cursor.fetchall()]
        latest: dict[str, dict[str, Any]] = {}
        for job in jobs:
            latest.setdefault(job["job_type"], job)
        return {
            "asset": asset,
            "transcript": transcript,
            "project": project,
            "latestJobs": latest,
        }

    @staticmethod
    def _aggregate_variants_status(
        proxy: dict[str, Any],
        audio: dict[str, Any],
        thumbnail: dict[str, Any],
        waveform: dict[str, Any],
    ) -> str:
        statuses = {proxy["status"], audio["status"], thumbnail["status"], waveform["status"]}
        if statuses == {"not_requested"}:
            return "not_requested"
        if audio["status"] in {"failed", "cancelled", "expired"}:
            return "failed"
        if any(s in {"claimed", "running", "processing", "uploading", "verifying"} for s in statuses):
            return "running"
        if audio["status"] == "succeeded":
            optional = [proxy["status"], thumbnail["status"], waveform["status"]]
            if any(s in {"failed", "cancelled", "expired"} for s in optional):
                return "degraded"
            return "succeeded"
        if audio["status"] in {"queued", "retry_wait"}:
            return "queued"
        return "working"

    async def _response(
        self, snapshot: dict[str, Any], worker_caps: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if snapshot.get("notFound"):
            return {"status": "not_found"}
        asset = snapshot["asset"]
        transcript = snapshot["transcript"]
        project = snapshot["project"]
        latest = snapshot["latestJobs"]

        if worker_caps is None:
            worker_caps = await ProcessingJobLeaseRepository(self.database).get_worker_capabilities()

        def job(job_type: str) -> dict[str, Any]:
            value = latest.get(job_type)
            return (
                {
                    "jobId": str(value["id"]),
                    "status": value["status"],
                    "progress": float(value["progress"]),
                    "stage": value["current_stage"],
                    "failureCode": value["failure_code"],
                    "failureMessage": value["failure_message"],
                    "createdAt": value["created_at"].isoformat() if value.get("created_at") else None,
                }
                if value
                else {"status": "not_requested"}
            )

        proxy_job = job("proxy_generation")
        audio_job = job("audio_extraction")
        thumb_job = job("thumbnail_generation")
        wave_job = job("waveform_generation")

        variants_aggregate = self._aggregate_variants_status(
            proxy_job, audio_job, thumb_job, wave_job
        )

        probe_job = job("media_probe")
        transcription_job = job("transcription")
        analysis_job = job("transcript_analysis")
        candidate_job = job("viral_candidate_analysis")

        # Determine if stalled or worker offline
        stalled_code: str | None = None
        stalled_message: str | None = None

        if probe_job["status"] in {"queued", "retry_wait"} and not worker_caps.get("media_worker_available", False):
            stalled_code = "media_worker_unavailable"
            stalled_message = "The media-processing worker is offline or does not support media_probe jobs."
        elif audio_job["status"] in {"queued", "retry_wait"} and not worker_caps.get("media_worker_available", False):
            stalled_code = "media_worker_unavailable"
            stalled_message = "The media-processing worker is offline or does not support audio_extraction jobs."
        elif transcription_job["status"] in {"queued", "retry_wait"} and not worker_caps.get("ai_worker_available", False):
            stalled_code = "ai_worker_unavailable"
            stalled_message = "The AI processing worker is offline or does not support transcription jobs."

        overall_status = "processing"
        if candidate_job["status"] == "succeeded":
            overall_status = "candidate_review"
        elif stalled_code is not None:
            overall_status = "stalled"
        elif any(
            j["status"] == "failed"
            for j in (probe_job, audio_job, transcription_job, candidate_job)
        ):
            overall_status = "failed"

        return {
            "status": overall_status,
            "stalledCode": stalled_code,
            "stalledMessage": stalled_message,
            "mediaAssetId": str(asset["id"]),
            "projectId": project["id"] if project else None,
            "projectRevision": project["revision"] if project else None,
            "transcriptId": transcript["id"] if transcript else None,
            "workerCapabilities": {
                "mediaWorkerAvailable": worker_caps.get("media_worker_available", False),
                "aiWorkerAvailable": worker_caps.get("ai_worker_available", False),
                "runtimeWorkerAvailable": worker_caps.get("runtime_worker_available", False),
                "exportWorkerAvailable": worker_caps.get("export_worker_available", False),
            },
            "stages": {
                "upload": {"status": "completed", "progress": 100},
                "probe": probe_job,
                "variants": {
                    "status": variants_aggregate,
                    "proxy": proxy_job,
                    "audio": audio_job,
                    "thumbnail": thumb_job,
                    "waveform": wave_job,
                },
                "transcription": transcription_job,
                "analysis": analysis_job,
                "candidates": candidate_job,
                "smartReframe": job("smart_reframe"),
                "derivation": job("project_derivation"),
                "conversion": job("project_conversion"),
                "export": job("clip_export"),
            },
        }

    async def advance(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> dict[str, Any]:
        # Track session heartbeat
        await ClipperSessionService(self.database).get_or_create_session(actor, media_asset_id)
        await ClipperSessionService(self.database).record_heartbeat(actor, media_asset_id)

        snapshot = await self._snapshot(actor, media_asset_id)
        if snapshot.get("notFound"):
            return await self._response(snapshot)

        asset = snapshot["asset"]
        latest = snapshot["latestJobs"]

        # Ensure media_probe job exists if media asset is uploaded but probe job was omitted
        if "media_probe" not in latest and asset["status"] in {"ready_for_probe", "queued", "upload_completed"}:
            async with self.database.transaction() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        INSERT INTO processing_jobs (
                          id, owner_user_id, media_asset_id, job_type, status, input
                        ) VALUES (%s, %s, %s, 'media_probe', 'queued', %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            uuid4(),
                            actor.user_id,
                            media_asset_id,
                            _json({
                                "schemaVersion": 1,
                                "jobType": "media_probe",
                                "mediaAssetId": str(media_asset_id),
                            }),
                        ),
                    )
            snapshot = await self._snapshot(actor, media_asset_id)
            latest = snapshot["latestJobs"]

        if asset["status"] != "ready":
            return await self._response(snapshot)

        transcript = snapshot["transcript"]
        project = snapshot["project"]

        if transcript is None or transcript["status"] not in {"queued", "transcribing", "normalizing", "ready"}:
            try:
                await TranscriptionPlanningService(self.database).plan(
                    media_asset_id, language_mode="auto"
                )
            except Exception as exc:
                if getattr(exc, "category", None) != "invalid_state":
                    raise
            snapshot = await self._snapshot(actor, media_asset_id)
            transcript = snapshot["transcript"]

        if transcript is None or transcript["status"] != "ready":
            return await self._response(snapshot)

        if project is None:
            request = CreateProjectRequest(
                mediaAssetId=media_asset_id,
                transcriptId=transcript["id"],
                name=f"{asset['display_name']} Short",
                canvas=CanvasInput(
                    aspectRatio="9:16",
                    width=1080,
                    height=1920,
                    background="#000000",
                    safeArea={"profile": "shorts-generic-v1"},
                ),
                metadata={"createdBy": "automatic_clipper_v1"},
            )
            config = ClippingOrchestrationConfig.from_env()
            project_response = await ClippingOrchestrationRepository(
                self.database
            ).create_project(
                actor,
                request,
                idempotency_key=f"clipper:{media_asset_id}:{transcript['id']}",
                maximum_ranges=config.maximum_ranges,
            )
            project_id = project_response["projectId"]
        else:
            project_id = project["id"]

        await TranscriptAnalysisPlanningService(self.database).plan(
            transcript["id"], include_transcript_review=True, include_silence=True
        )
        snapshot = await self._snapshot(actor, media_asset_id)
        latest = snapshot["latestJobs"]
        if any(
            latest.get(job_type, {}).get("status") != "succeeded"
            for job_type in ("silence_analysis", "transcript_analysis")
        ):
            return await self._response(snapshot)

        project = snapshot["project"]
        await AutomaticClipperRepository(self.database).plan_candidates(
            actor, project_id, expected_revision=project["revision"]
        )
        return await self._response(await self._snapshot(actor, media_asset_id))


__all__ = ["AutomaticClipperWorkflowService"]
