from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from server.clipping_jobs.policies import DEFAULT_JOB_POLICIES
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError

try:
    from contracts.transcript_document_v2 import TranscriptDocumentV2
except ImportError:
    from backend.contracts.transcript_document_v2 import TranscriptDocumentV2

from .contracts import (
    TranscriptionJobInputV1,
    TranscriptionOptionsV1,
    normalize_language_mode,
    sanitize_hotwords,
)
from .identity import transcription_request_identity

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


class TranscriptionPlanningService:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    async def plan(
        self,
        media_asset_id: Any,
        *,
        language_mode: str = "auto",
        provider_preference: str | None = None,
        hotwords: list[str] | None = None,
        options: TranscriptionOptionsV1 | None = None,
    ) -> dict[str, Any]:
        options = options or TranscriptionOptionsV1()
        hotwords = sanitize_hotwords(hotwords or [])
        try:
            async with self.database.transaction() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        "SELECT * FROM media_assets WHERE id=%s FOR UPDATE",
                        (media_asset_id,),
                    )
                    asset_row = await cursor.fetchone()
                    if asset_row is None:
                        raise PersistenceError(
                            "entity_not_found", "Media asset was not found"
                        )
                    asset = dict(asset_row)
                    if (
                        asset["status"] != "ready"
                        or asset["deleted_at"] is not None
                        or asset["storage_object_revision"] is None
                        or asset["duration_ms"] is None
                    ):
                        raise PersistenceError(
                            "invalid_state",
                            "Media asset is not ready for transcription",
                        )
                    await cursor.execute(
                        """
                        SELECT * FROM media_variants
                        WHERE media_asset_id=%s
                          AND variant_type='audio_extract'
                          AND status='ready'
                          AND deleted_at IS NULL
                          AND source_media_revision=%s
                          AND source_storage_object_revision=%s
                          AND generation_spec->>'preset'=
                            'transcription-wav-16k-mono-v1'
                        ORDER BY ready_at DESC,id DESC LIMIT 1
                        FOR UPDATE
                        """,
                        (
                            asset["id"],
                            asset["revision"],
                            asset["storage_object_revision"],
                        ),
                    )
                    variant_row = await cursor.fetchone()
                    if variant_row is None:
                        raise PersistenceError(
                            "invalid_state",
                            "Ready transcription audio is unavailable",
                        )
                    variant = dict(variant_row)
                    canonical_language_mode = normalize_language_mode(
                        language_mode
                    )
                    identity = transcription_request_identity(
                        media_asset_id=asset["id"],
                        media_revision=asset["revision"],
                        storage_object_revision=asset[
                            "storage_object_revision"
                        ],
                        audio_variant_id=variant["id"],
                        audio_variant_revision=variant["revision"],
                        language_mode=canonical_language_mode,
                        provider_preference=provider_preference,
                        hotwords=hotwords,
                        options=options.model_dump(mode="json"),
                    )
                    transcript_id = f"tr_{identity[:32]}"
                    job_input = TranscriptionJobInputV1(
                        mediaAssetId=asset["id"],
                        expectedMediaRevision=asset["revision"],
                        storageObjectRevision=asset[
                            "storage_object_revision"
                        ],
                        audioVariantId=variant["id"],
                        audioVariantRevision=variant["revision"],
                        transcriptId=transcript_id,
                        requestIdentity=identity,
                        languageMode=canonical_language_mode,
                        providerPreference=provider_preference,
                        hotwords=hotwords,
                        options=options,
                    )
                    now = datetime.now(timezone.utc)
                    placeholder = TranscriptDocumentV2.model_validate(
                        {
                            "schemaVersion": 2,
                            "transcriptId": transcript_id,
                            "mediaId": str(asset["id"]),
                            "durationMs": asset["duration_ms"],
                            "languageMode": job_input.languageMode,
                            "detectedLanguages": [],
                            "provider": {
                                "name": "pending",
                                "model": None,
                                "requestId": None,
                                "metadata": {},
                            },
                            "segments": [],
                            "words": [],
                            "speakers": [],
                            "silenceRegions": [],
                            "quality": {},
                            "metadata": {},
                            "createdAt": now,
                            "updatedAt": now,
                        }
                    ).model_dump(mode="json")
                    await cursor.execute(
                        """
                        INSERT INTO transcripts (
                          id,owner_user_id,media_asset_id,schema_version,
                          language_mode,duration_ms,status,document,quality,
                          metadata,media_revision,storage_object_revision,
                          audio_variant_id,audio_variant_revision,
                          request_identity
                        ) VALUES (
                          %s,%s,%s,2,%s,%s,'queued',%s,%s,%s,%s,%s,%s,%s,%s
                        )
                        ON CONFLICT (owner_user_id,request_identity)
                          WHERE request_identity IS NOT NULL
                            AND deleted_at IS NULL
                        DO UPDATE SET updated_at=transcripts.updated_at
                        RETURNING *
                        """,
                        (
                            transcript_id,
                            asset["owner_user_id"],
                            asset["id"],
                            job_input.languageMode,
                            asset["duration_ms"],
                            _json(placeholder),
                            _json(placeholder["quality"]),
                            _json({}),
                            asset["revision"],
                            asset["storage_object_revision"],
                            variant["id"],
                            variant["revision"],
                            identity,
                        ),
                    )
                    transcript = dict(await cursor.fetchone())
                    payload = job_input.model_dump(mode="json")
                    policy = DEFAULT_JOB_POLICIES["transcription"]
                    await cursor.execute(
                        """
                        INSERT INTO processing_jobs (
                          id,owner_user_id,media_asset_id,job_type,status,
                          priority,input,max_attempts,idempotency_key,
                          execution_timeout_seconds
                        ) VALUES (
                          %s,%s,%s,'transcription','queued',%s,%s,%s,%s,%s
                        )
                        ON CONFLICT (
                          owner_user_id,job_type,idempotency_key
                        ) DO UPDATE SET updated_at=processing_jobs.updated_at
                        RETURNING *
                        """,
                        (
                            uuid4(),
                            asset["owner_user_id"],
                            asset["id"],
                            policy.priority,
                            _json(payload),
                            policy.maximum_attempts,
                            f"transcription:{identity}",
                            policy.default_timeout_seconds,
                        ),
                    )
                    job = dict(await cursor.fetchone())
                    return {
                        "transcript": transcript,
                        "job": job,
                        "audioVariant": variant,
                    }
        except PersistenceError:
            raise


__all__ = ["TranscriptionPlanningService"]
