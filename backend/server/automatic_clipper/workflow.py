from __future__ import annotations

from typing import Any
from uuid import UUID

from server.clipping_orchestration.config import ClippingOrchestrationConfig
from server.clipping_orchestration.contracts import CanvasInput, CreateProjectRequest
from server.clipping_orchestration.repository import ClippingOrchestrationRepository
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.models import AuthenticatedActor
from server.durable_transcription.planning import TranscriptionPlanningService
from server.transcript_analysis.planning import TranscriptAnalysisPlanningService

from .repository import AutomaticClipperRepository


class AutomaticClipperWorkflowService:
    """Idempotently advances existing Stage 2/3 planners; stores no workflow row."""

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
    def _response(snapshot: dict[str, Any]) -> dict[str, Any]:
        if snapshot.get("notFound"):
            return {"status": "not_found"}
        asset = snapshot["asset"]
        transcript = snapshot["transcript"]
        project = snapshot["project"]
        latest = snapshot["latestJobs"]

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
                }
                if value
                else {"status": "not_requested"}
            )

        return {
            "status": (
                "candidate_review"
                if latest.get("viral_candidate_analysis", {}).get("status")
                == "succeeded"
                else "processing"
            ),
            "mediaAssetId": str(asset["id"]),
            "projectId": project["id"] if project else None,
            "projectRevision": project["revision"] if project else None,
            "transcriptId": transcript["id"] if transcript else None,
            "stages": {
                "upload": {"status": "completed"},
                "probe": job("media_probe"),
                "variants": {
                    "proxy": job("proxy_generation"),
                    "audio": job("audio_extraction"),
                    "thumbnail": job("thumbnail_generation"),
                    "waveform": job("waveform_generation"),
                },
                "transcription": job("transcription"),
                "analysis": job("transcript_analysis"),
                "candidates": job("viral_candidate_analysis"),
                "smartReframe": job("smart_reframe"),
                "derivation": job("project_derivation"),
                "conversion": job("project_conversion"),
                "export": job("clip_export"),
            },
        }

    async def advance(
        self, actor: AuthenticatedActor, media_asset_id: UUID
    ) -> dict[str, Any]:
        snapshot = await self._snapshot(actor, media_asset_id)
        if snapshot.get("notFound"):
            return self._response(snapshot)
        asset = snapshot["asset"]
        transcript = snapshot["transcript"]
        project = snapshot["project"]
        if asset["status"] != "ready":
            return self._response(snapshot)
        if transcript is None or transcript["status"] not in {"queued", "transcribing", "normalizing", "ready"}:
            try:
                await TranscriptionPlanningService(self.database).plan(
                    media_asset_id, language_mode="auto"
                )
            except Exception as exc:
                # Not-ready audio is an expected polling state. Other durable
                # failures remain visible through their jobs and retry policy.
                if getattr(exc, "category", None) != "invalid_state":
                    raise
            snapshot = await self._snapshot(actor, media_asset_id)
            transcript = snapshot["transcript"]
        if transcript is None or transcript["status"] != "ready":
            return self._response(snapshot)
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
            return self._response(snapshot)
        project = snapshot["project"]
        await AutomaticClipperRepository(self.database).plan_candidates(
            actor, project_id, expected_revision=project["revision"]
        )
        return self._response(await self._snapshot(actor, media_asset_id))


__all__ = ["AutomaticClipperWorkflowService"]
