from __future__ import annotations

from typing import Any
from uuid import uuid4

from server.clipping_jobs.policies import DEFAULT_JOB_POLICIES
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError

from .contracts import SilenceAnalysisJobInputV1, TranscriptAnalysisJobInputV1
from .identity import analysis_identity
from .presets import (
    SILENCE_SPEC,
    SILENCE_SPEC_HASH,
    TRANSCRIPT_REVIEW_SPEC,
    TRANSCRIPT_REVIEW_SPEC_HASH,
)

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


class TranscriptAnalysisPlanningService:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    async def plan(
        self,
        transcript_id: str,
        *,
        include_transcript_review: bool = True,
        include_silence: bool = True,
    ) -> dict[str, Any]:
        planned: dict[str, Any] = {}
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT * FROM transcripts WHERE id=%s FOR UPDATE", (transcript_id,))
                transcript_row = await cursor.fetchone()
                if transcript_row is None:
                    raise PersistenceError("not_found", "Transcript was not found")
                transcript = dict(transcript_row)
                if transcript["status"] != "ready" or transcript["deleted_at"] is not None:
                    raise PersistenceError("invalid_state", "Transcript is not ready for analysis")
                await cursor.execute("SELECT * FROM media_assets WHERE id=%s FOR UPDATE", (transcript["media_asset_id"],))
                asset_row = await cursor.fetchone()
                if asset_row is None:
                    raise PersistenceError("not_found", "Media asset was not found")
                asset = dict(asset_row)
                if asset["status"] != "ready" or asset["deleted_at"] is not None:
                    raise PersistenceError("invalid_state", "Media asset is not ready for analysis")
                if transcript["media_revision"] != asset["revision"]:
                    raise PersistenceError("conflict", "Transcript targets a stale media revision")

                async def insert_analysis(
                    *,
                    analysis_type: str,
                    spec: dict[str, Any],
                    spec_hash: str,
                    variant: dict[str, Any] | None,
                ):
                    identity = analysis_identity(
                        media_asset_id=asset["id"],
                        media_revision=asset["revision"],
                        transcript_id=transcript["id"],
                        transcript_revision=transcript["revision"],
                        audio_variant_id=variant["id"] if variant else None,
                        audio_variant_revision=variant["revision"] if variant else None,
                        analysis_type=analysis_type,
                        spec_hash=spec_hash,
                    )
                    analysis_id = f"analysis_{identity[:32]}"
                    await cursor.execute(
                        """INSERT INTO transcript_analyses (
                        id,owner_user_id,media_asset_id,transcript_id,transcript_revision,
                        media_revision,audio_variant_id,audio_variant_revision,analysis_type,
                        schema_version,analysis_spec,analysis_spec_hash,status
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,1,%s,%s,'queued')
                        ON CONFLICT (id) DO UPDATE SET updated_at=transcript_analyses.updated_at
                        RETURNING *""",
                        (
                            analysis_id, asset["owner_user_id"], asset["id"], transcript["id"],
                            transcript["revision"], asset["revision"],
                            variant["id"] if variant else None, variant["revision"] if variant else None,
                            analysis_type, _json(spec), spec_hash,
                        ),
                    )
                    analysis = dict(await cursor.fetchone())
                    if analysis["status"] == "failed":
                        return {"analysis": analysis, "job": None, "reused": True}
                    if analysis_type == "silence":
                        payload_model = SilenceAnalysisJobInputV1(
                            analysisId=analysis_id,
                            mediaAssetId=asset["id"],
                            expectedMediaRevision=asset["revision"],
                            transcriptId=transcript["id"],
                            expectedTranscriptRevision=transcript["revision"],
                            audioVariantId=variant["id"],
                            expectedAudioVariantRevision=variant["revision"],
                            analysisSpecHash=spec_hash,
                            preset="speech-silence-v1",
                        )
                        job_type = "silence_analysis"
                    else:
                        payload_model = TranscriptAnalysisJobInputV1(
                            analysisId=analysis_id,
                            mediaAssetId=asset["id"],
                            expectedMediaRevision=asset["revision"],
                            transcriptId=transcript["id"],
                            expectedTranscriptRevision=transcript["revision"],
                            analysisSpecHash=spec_hash,
                            analysisKinds=spec["analysisKinds"],
                            preset="transcript-review-v1",
                        )
                        job_type = "transcript_analysis"
                    policy = DEFAULT_JOB_POLICIES[job_type]
                    await cursor.execute(
                        """INSERT INTO processing_jobs (
                        id,owner_user_id,media_asset_id,job_type,status,priority,input,
                        max_attempts,idempotency_key,execution_timeout_seconds
                        ) VALUES (%s,%s,%s,%s,'queued',%s,%s,%s,%s,%s)
                        ON CONFLICT (owner_user_id,job_type,idempotency_key)
                        DO UPDATE SET updated_at=processing_jobs.updated_at RETURNING *""",
                        (
                            uuid4(), asset["owner_user_id"], asset["id"], job_type,
                            policy.priority, _json(payload_model.model_dump(mode="json")),
                            policy.maximum_attempts, f"{job_type}:{identity}",
                            policy.default_timeout_seconds,
                        ),
                    )
                    return {"analysis": analysis, "job": dict(await cursor.fetchone()), "reused": analysis["status"] == "ready"}

                if include_transcript_review:
                    planned["transcriptReview"] = await insert_analysis(
                        analysis_type="transcript_review",
                        spec=TRANSCRIPT_REVIEW_SPEC,
                        spec_hash=TRANSCRIPT_REVIEW_SPEC_HASH,
                        variant=None,
                    )
                if include_silence:
                    await cursor.execute(
                        """SELECT * FROM media_variants WHERE media_asset_id=%s
                        AND variant_type='audio_extract' AND status='ready' AND deleted_at IS NULL
                        AND source_media_revision=%s
                        AND source_storage_object_revision=%s
                        AND generation_spec->>'preset'='transcription-wav-16k-mono-v1'
                        ORDER BY ready_at DESC,id DESC LIMIT 1 FOR UPDATE""",
                        (
                            asset["id"],
                            asset["revision"],
                            asset["storage_object_revision"],
                        ),
                    )
                    variant_row = await cursor.fetchone()
                    if variant_row is not None:
                        planned["silence"] = await insert_analysis(
                            analysis_type="silence",
                            spec=SILENCE_SPEC,
                            spec_hash=SILENCE_SPEC_HASH,
                            variant=dict(variant_row),
                        )
                    else:
                        planned["silence"] = {"skipped": "ready_audio_variant_unavailable"}
        return planned


__all__ = ["TranscriptAnalysisPlanningService"]
