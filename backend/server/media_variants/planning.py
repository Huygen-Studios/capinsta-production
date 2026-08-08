from __future__ import annotations

from typing import Any
from uuid import uuid4

from server.clipping_jobs.policies import DEFAULT_JOB_POLICIES
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError

from .presets import (
    JOB_TO_PRESET,
    JOB_TO_VARIANT,
    generation_spec_hash,
    preset_spec,
)

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


class MediaVariantPlanningService:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    @staticmethod
    def required_job_types(probe_result: dict[str, Any]) -> tuple[str, ...]:
        if probe_result.get("mediaKind") == "video":
            result = ["proxy_generation", "thumbnail_generation"]
            if probe_result.get("audio") is not None:
                result.extend(["audio_extraction", "waveform_generation"])
            return tuple(result)
        if (
            probe_result.get("mediaKind") == "audio"
            and probe_result.get("audio") is not None
        ):
            return ("audio_extraction", "waveform_generation")
        return ()

    @classmethod
    async def plan_in_transaction(
        cls,
        connection: Any,
        *,
        asset: dict[str, Any],
        probe_result: dict[str, Any],
    ) -> list[dict[str, Any]]:
        planned: list[dict[str, Any]] = []
        async with connection.cursor() as cursor:
            for job_type in cls.required_job_types(probe_result):
                preset = JOB_TO_PRESET[job_type]
                variant_type = JOB_TO_VARIANT[job_type]
                spec = preset_spec(preset)
                spec_hash = generation_spec_hash(spec)
                await cursor.execute(
                    """
                    INSERT INTO media_variants (
                      id,media_asset_id,variant_type,status,
                      source_media_revision,
                      source_storage_object_revision,generation_spec,
                      generation_spec_hash
                    ) VALUES (%s,%s,%s,'queued',%s,%s,%s,%s)
                    ON CONFLICT (
                      media_asset_id,variant_type,
                      source_media_revision,generation_spec_hash
                    ) WHERE deleted_at IS NULL
                      AND source_media_revision IS NOT NULL
                      AND generation_spec_hash IS NOT NULL
                    DO UPDATE SET updated_at=media_variants.updated_at
                    RETURNING *
                    """,
                    (
                        uuid4(),
                        asset["id"],
                        variant_type,
                        asset["revision"],
                        asset["storage_object_revision"],
                        _json(spec),
                        spec_hash,
                    ),
                )
                variant = dict(await cursor.fetchone())
                input_payload = {
                    "schemaVersion": 1,
                    "jobType": job_type,
                    "mediaAssetId": str(asset["id"]),
                    "expectedMediaRevision": asset["revision"],
                    "storageObjectRevision": asset[
                        "storage_object_revision"
                    ],
                    "variantId": str(variant["id"]),
                    "generationSpecHash": spec_hash,
                    "preset": preset,
                    "metadata": {},
                }
                idempotency_key = f"variant:{variant['id']}:{spec_hash}"
                policy = DEFAULT_JOB_POLICIES[job_type]
                await cursor.execute(
                    """
                    INSERT INTO processing_jobs (
                      id,owner_user_id,media_asset_id,job_type,status,
                      priority,input,max_attempts,idempotency_key,
                      execution_timeout_seconds
                    ) VALUES (
                      %s,%s,%s,%s,'queued',%s,%s,%s,%s,%s
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
                        job_type,
                        policy.priority,
                        _json(input_payload),
                        policy.maximum_attempts,
                        idempotency_key,
                        policy.default_timeout_seconds,
                    ),
                )
                job = dict(await cursor.fetchone())
                planned.append({"variant": variant, "job": job})
        return planned

    async def plan(self, media_asset_id: Any) -> list[dict[str, Any]]:
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
                    ):
                        raise PersistenceError(
                            "invalid_state",
                            "Media asset is not ready for variant planning",
                        )
                    await cursor.execute(
                        """
                        SELECT output FROM processing_jobs
                        WHERE media_asset_id=%s AND job_type='media_probe'
                          AND status='succeeded'
                          AND (output->>'mediaAssetRevision')::bigint=%s
                        ORDER BY finished_at DESC,id DESC LIMIT 1
                        """,
                        (asset["id"], asset["revision"]),
                    )
                    probe_row = await cursor.fetchone()
                    if probe_row is None:
                        raise PersistenceError(
                            "invalid_state",
                            "The current media-probe result is unavailable",
                        )
                return await self.plan_in_transaction(
                    connection, asset=asset, probe_result=probe_row["output"]
                )
        except PersistenceError:
            raise


__all__ = ["MediaVariantPlanningService"]
