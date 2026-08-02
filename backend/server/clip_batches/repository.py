from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5
from copy import deepcopy
import hashlib
import json

from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.models import AuthenticatedActor
from server.clipping_persistence.validation import ensure_portable_json
from server.clipping_handoff.contracts import collect_project_media_ids
from server.clipping_orchestration.identity import canonical_hash
from contracts.transcript_document_v2 import to_transcript_document_v2

from .contracts import (
    CreateBatchRequest,
    CreateItemRequest,
    MAX_CLIP_DURATION_MS,
    ReorderItemsRequest,
    UpdateBatchRequest,
    UpdateItemRequest,
)
from .errors import ClipBatchError

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


def _iso(value: Any) -> Any:
    return value.isoformat() if hasattr(value, "isoformat") else value


class ClipBatchRepository:
    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    @staticmethod
    def _item(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "schemaVersion": 1,
            "id": str(row["id"]),
            "batchId": str(row["batch_id"]),
            "ordinal": row["ordinal"],
            "title": row["title"],
            "sourceStartMs": row["source_start_ms"],
            "sourceEndMs": row["source_end_ms"],
            "durationMs": row["source_end_ms"] - row["source_start_ms"],
            "status": row["status"],
            "selectedForExport": row["selected_for_export"],
            "childProjectId": row["child_project_id"],
            "childProjectRevision": row["child_project_revision"],
            "captionStatus": row["caption_status"],
            "captionJobId": row.get("caption_job_id"),
            "headingStatus": row["heading_status"],
            "exportStatus": row["export_status"],
            "createdAt": _iso(row["created_at"]),
            "updatedAt": _iso(row["updated_at"]),
            "revision": row["revision"],
        }

    @staticmethod
    def _batch(row: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "schemaVersion": 1,
            "id": str(row["id"]),
            "ownerUserId": str(row["owner_user_id"]),
            "sourceMediaAssetId": str(row["source_media_asset_id"]),
            "sourceMediaRevision": row["source_media_revision"],
            "sourceDurationMs": row["metadata"].get("sourceDurationMs"),
            "sourceProjectId": row["source_project_id"],
            "title": row["title"],
            "status": row["status"],
            "platformPreset": row["platform_preset"],
            "captionsEnabled": row["captions_enabled"],
            "headingsEnabled": row["headings_enabled"],
            "captionPreset": row["caption_preset"],
            "maximumClipDurationMs": row["maximum_clip_duration_ms"],
            "createdAt": _iso(row["created_at"]),
            "updatedAt": _iso(row["updated_at"]),
            "revision": row["revision"],
            "items": items,
        }

    @staticmethod
    async def _load(connection, actor: AuthenticatedActor, batch_id: UUID, *, lock=False):
        suffix = " FOR UPDATE" if lock else ""
        async with connection.cursor() as cursor:
            await cursor.execute(
                f"SELECT * FROM clip_batches WHERE id=%s AND owner_user_id=%s AND deleted_at IS NULL{suffix}",
                (batch_id, actor.user_id),
            )
            row = await cursor.fetchone()
        if row is None:
            raise ClipBatchError("clip_batch_not_found", "Clip batch was not found", 404)
        return dict(row)

    @staticmethod
    async def _items(connection, batch_id: UUID):
        async with connection.cursor() as cursor:
            await cursor.execute(
                "SELECT * FROM clip_batch_items WHERE batch_id=%s AND deleted_at IS NULL ORDER BY ordinal,id",
                (batch_id,),
            )
            return [dict(row) for row in await cursor.fetchall()]

    async def create(self, actor: AuthenticatedActor, request: CreateBatchRequest, *, idempotency_key: str) -> dict[str, Any]:
        payload = request.model_dump(mode="json")
        request_hash = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        batch_id = uuid5(NAMESPACE_URL, f"capinsta:clip-batch:{actor.user_id}:{idempotency_key}")
        transcript_id = f"tr_manual_{batch_id.hex}"
        now = datetime.now(timezone.utc)
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT * FROM clip_batches WHERE id=%s AND owner_user_id=%s",
                    (batch_id, actor.user_id),
                )
                existing = await cursor.fetchone()
                if existing is not None:
                    existing = dict(existing)
                    if existing["metadata"].get("requestHash") != request_hash:
                        raise ClipBatchError("idempotency_conflict", "Idempotency key was used with a different request", 409)
                    items = await self._items(connection, batch_id)
                    return self._batch(existing, [self._item(item) for item in items])
                await cursor.execute(
                    "SELECT * FROM media_assets WHERE id=%s AND owner_user_id=%s AND deleted_at IS NULL FOR UPDATE",
                    (request.sourceMediaAssetId, actor.user_id),
                )
                media_row = await cursor.fetchone()
                if media_row is None:
                    raise ClipBatchError("source_media_not_found", "Source video was not found", 404)
                media = dict(media_row)
                if media["status"] != "ready" or not media["duration_ms"]:
                    raise ClipBatchError("media_not_ready", "The source video is still being prepared", 409)
                document = {
                    "schemaVersion": 2,
                    "transcriptId": transcript_id,
                    "mediaId": str(media["id"]),
                    "durationMs": media["duration_ms"],
                    "languageMode": "auto",
                    "detectedLanguages": [],
                    "provider": {"name": "manual", "model": None, "requestId": None, "metadata": {}},
                    "segments": [],
                    "words": [],
                    "speakers": [],
                    "silenceRegions": [],
                    "quality": {
                        "overallScore": None,
                        "timingScore": None,
                        "confidenceScore": None,
                        "lowConfidenceWordCount": 0,
                        "untimedWordCount": 0,
                        "overlapCount": 0,
                        "warnings": [],
                    },
                    "metadata": {"purpose": "manual_clipping", "generated": False},
                    "createdAt": now.isoformat(),
                    "updatedAt": now.isoformat(),
                }
                await cursor.execute(
                    """INSERT INTO transcripts(
                    id,owner_user_id,media_asset_id,schema_version,language_mode,duration_ms,
                    status,revision,document,metadata
                    ) VALUES (%s,%s,%s,2,'auto',%s,'ready',1,%s,%s)""",
                    (
                        transcript_id,
                        actor.user_id,
                        media["id"],
                        media["duration_ms"],
                        _json(document),
                        _json({"purpose": "manual_clipping", "generated": False}),
                    ),
                )
                await cursor.execute(
                    """INSERT INTO clip_batches(
                    id,owner_user_id,source_media_asset_id,source_media_revision,title,
                    platform_preset,captions_enabled,headings_enabled,caption_preset,
                    maximum_clip_duration_ms,metadata
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                    (
                        batch_id,
                        actor.user_id,
                        media["id"],
                        media["revision"],
                        request.title,
                        request.platformPreset,
                        request.captionsEnabled,
                        request.headingsEnabled,
                        request.captionPreset,
                        request.maximumClipDurationMs,
                        _json({"transcriptId": transcript_id, "sourceDurationMs": media["duration_ms"], "idempotencyKey": idempotency_key, "requestHash": request_hash}),
                    ),
                )
                batch = dict(await cursor.fetchone())
        return self._batch(batch, [])

    async def context(self, actor: AuthenticatedActor, batch_id: UUID) -> dict[str, Any]:
        async with self.database.connection() as connection:
            batch = await self._load(connection, actor, batch_id)
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT duration_ms,width,height FROM media_assets WHERE id=%s", (batch["source_media_asset_id"],))
                media = dict(await cursor.fetchone())
            items = await self._items(connection, batch_id)
        return {"batch": batch, "media": media, "items": items, "transcriptId": batch["metadata"]["transcriptId"]}

    async def ensure_item_transcript(self, actor: AuthenticatedActor, batch_id: UUID, item_id: UUID) -> str:
        transcript_id = f"tr_clip_{item_id.hex}"
        async with self.database.transaction() as connection:
            batch = await self._load(connection, actor, batch_id, lock=True)
            items = await self._items(connection, batch_id)
            item = next((value for value in items if value["id"] == item_id), None)
            if item is None:
                raise ClipBatchError("clip_batch_item_not_found", "Clip was not found", 404)
            now = datetime.now(timezone.utc)
            duration_ms = batch["metadata"]["sourceDurationMs"]
            document = {
                "schemaVersion": 2,
                "transcriptId": transcript_id,
                "mediaId": str(batch["source_media_asset_id"]),
                "durationMs": duration_ms,
                "languageMode": "auto",
                "detectedLanguages": [],
                "provider": {"name": "manual", "model": None, "requestId": None, "metadata": {}},
                "segments": [], "words": [], "speakers": [], "silenceRegions": [],
                "quality": {"overallScore": None, "timingScore": None, "confidenceScore": None,
                            "lowConfidenceWordCount": 0, "untimedWordCount": 0, "overlapCount": 0, "warnings": []},
                "metadata": {"purpose": "manual_clip_caption", "clipBatchId": str(batch_id), "clipBatchItemId": str(item_id)},
                "createdAt": now.isoformat(), "updatedAt": now.isoformat(),
            }
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """INSERT INTO transcripts(id,owner_user_id,media_asset_id,schema_version,language_mode,
                    duration_ms,status,revision,document,metadata) VALUES (%s,%s,%s,2,'auto',%s,'ready',1,%s,%s)
                    ON CONFLICT(id) DO NOTHING""",
                    (transcript_id, actor.user_id, batch["source_media_asset_id"], duration_ms, _json(document), _json(document["metadata"])),
                )
        return transcript_id

    async def persist_caption_transcript(
        self, actor: AuthenticatedActor, batch_id: UUID, item_id: UUID, *, job_id: str, transcript: dict[str, Any]
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            batch = await self._load(connection, actor, batch_id, lock=True)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT * FROM clip_batch_items WHERE id=%s AND batch_id=%s AND deleted_at IS NULL FOR UPDATE",
                    (item_id, batch_id),
                )
                found = await cursor.fetchone()
                if found is None:
                    raise ClipBatchError("clip_batch_item_not_found", "Clip was not found", 404)
                item = dict(found)
                metadata = dict(item["metadata"] or {})
                if metadata.get("captionPersistedJobId") == job_id:
                    return self._item(item)
                if item["caption_job_id"] != job_id or not item["child_project_id"]:
                    raise ClipBatchError("caption_job_conflict", "Caption job does not match this clip", 409)
                await cursor.execute(
                    "SELECT * FROM clip_projects WHERE id=%s AND owner_user_id=%s AND deleted_at IS NULL FOR UPDATE",
                    (item["child_project_id"], actor.user_id),
                )
                project_row = await cursor.fetchone()
                if project_row is None or project_row["revision"] != item["child_project_revision"]:
                    raise ClipBatchError("caption_project_revision_conflict", "The clip project changed while captions were generated", 409)
                await cursor.execute(
                    "SELECT * FROM transcripts WHERE id=%s AND owner_user_id=%s AND deleted_at IS NULL FOR UPDATE",
                    (project_row["transcript_id"], actor.user_id),
                )
                transcript_row = await cursor.fetchone()
                if transcript_row is None:
                    raise ClipBatchError("caption_transcript_not_found", "The clip transcript was not found", 409)
                duration_ms = batch["metadata"]["sourceDurationMs"]
                shifted = deepcopy(transcript)
                offset_seconds = item["source_start_ms"] / 1000
                for segment in shifted.get("segments") or []:
                    for key in ("start", "end"):
                        if segment.get(key) is not None:
                            segment[key] = float(segment[key]) + offset_seconds
                    for word in segment.get("words") or []:
                        for key in ("start", "end"):
                            if word.get(key) is not None:
                                word[key] = float(word[key]) + offset_seconds
                document = to_transcript_document_v2(
                    shifted,
                    transcript_id=transcript_row["id"],
                    media_id=str(batch["source_media_asset_id"]),
                    duration_ms=duration_ms,
                    created_at=transcript_row["created_at"],
                ).model_dump(mode="json")
                document["metadata"].update({"clipBatchId": str(batch_id), "clipBatchItemId": str(item_id), "captionJobId": job_id})
                document["updatedAt"] = datetime.now(timezone.utc).isoformat()
                transcript_metadata = dict(transcript_row["metadata"] or {})
                transcript_metadata.update({"generated": True, "captionJobId": job_id})
                await cursor.execute(
                    """UPDATE transcripts SET document=%s,metadata=%s,language_mode=%s,status='ready',
                    revision=revision+1,updated_at=now() WHERE id=%s RETURNING revision""",
                    (_json(document), _json(transcript_metadata), document["languageMode"], transcript_row["id"]),
                )
                transcript_revision = (await cursor.fetchone())["revision"]
                project = dict(project_row["project"])
                project_revision = project_row["revision"] + 1
                project["revision"] = project_revision
                project["updatedAt"] = datetime.now(timezone.utc).isoformat()
                await cursor.execute(
                    """UPDATE clip_projects SET project=%s,revision=%s,transcript_revision=%s,
                    latest_edl=NULL,latest_remapped_transcript=NULL,latest_conversion_result=NULL,
                    latest_edl_revision=NULL,latest_remapped_transcript_revision=NULL,latest_conversion_revision=NULL,
                    latest_derivation_transcript_revision=NULL,latest_derivation_result_identity=NULL,
                    latest_conversion_result_identity=NULL,updated_at=now() WHERE id=%s""",
                    (_json(project), project_revision, transcript_revision, project_row["id"]),
                )
                await cursor.execute(
                    """INSERT INTO clip_project_versions(clip_project_id,revision,project,created_by,
                    change_summary,version_source,transcript_revision) VALUES (%s,%s,%s,%s,
                    'Persist generated clip captions','system_import',%s)""",
                    (project_row["id"], project_revision, _json(project), actor.user_id, transcript_revision),
                )
                metadata["captionPersistedJobId"] = job_id
                await cursor.execute(
                    """UPDATE clip_batch_items SET child_project_revision=%s,caption_status='processing',metadata=%s,
                    revision=revision+1,updated_at=now() WHERE id=%s RETURNING *""",
                    (project_revision, _json(metadata), item_id),
                )
                return self._item(dict(await cursor.fetchone()))

    async def get(self, actor: AuthenticatedActor, batch_id: UUID) -> dict[str, Any]:
        async with self.database.connection() as connection:
            batch = await self._load(connection, actor, batch_id)
            items = await self._items(connection, batch_id)
        return self._batch(batch, [self._item(item) for item in items])

    async def update(self, actor: AuthenticatedActor, batch_id: UUID, request: UpdateBatchRequest):
        values = request.model_dump(exclude={"expectedRevision"}, exclude_none=True)
        names = {
            "title": "title",
            "captionsEnabled": "captions_enabled",
            "headingsEnabled": "headings_enabled",
            "captionPreset": "caption_preset",
            "platformPreset": "platform_preset",
            "maximumClipDurationMs": "maximum_clip_duration_ms",
        }
        async with self.database.transaction() as connection:
            batch = await self._load(connection, actor, batch_id, lock=True)
            if batch["revision"] != request.expectedRevision:
                raise ClipBatchError("clip_batch_revision_conflict", "Clip batch revision is stale", 409)
            if values:
                assignments = [f"{names[key]}=%s" for key in values]
                params = list(values.values()) + [batch_id]
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        f"UPDATE clip_batches SET {','.join(assignments)},revision=revision+1,updated_at=now() WHERE id=%s RETURNING *",
                        params,
                    )
                    batch = dict(await cursor.fetchone())
            items = await self._items(connection, batch_id)
        return self._batch(batch, [self._item(item) for item in items])

    async def add_item(self, actor: AuthenticatedActor, batch_id: UUID, request: CreateItemRequest):
        async with self.database.transaction() as connection:
            batch = await self._load(connection, actor, batch_id, lock=True)
            if request.sourceEndMs > await self._source_duration(connection, batch):
                raise ClipBatchError("clip_range_out_of_bounds", "Clip range exceeds the source video", 422)
            if request.sourceEndMs - request.sourceStartMs > batch["maximum_clip_duration_ms"]:
                raise ClipBatchError("clip_range_invalid", "Clip range exceeds this batch's maximum duration", 422)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT count(*) AS count FROM clip_batch_items WHERE batch_id=%s AND deleted_at IS NULL",
                    (batch_id,),
                )
                if (await cursor.fetchone())["count"] >= 12:
                    raise ClipBatchError("clip_batch_item_limit", "A clip batch supports at most 12 clips", 422)
                await cursor.execute(
                    "SELECT COALESCE(max(ordinal),0)+1 AS ordinal FROM clip_batch_items WHERE batch_id=%s AND deleted_at IS NULL",
                    (batch_id,),
                )
                ordinal = (await cursor.fetchone())["ordinal"]
                await cursor.execute(
                    """INSERT INTO clip_batch_items(
                    batch_id,ordinal,title,source_start_ms,source_end_ms
                    ) VALUES (%s,%s,%s,%s,%s) RETURNING *""",
                    (batch_id, ordinal, request.title, request.sourceStartMs, request.sourceEndMs),
                )
                item = dict(await cursor.fetchone())
                await cursor.execute("UPDATE clip_batches SET revision=revision+1,updated_at=now() WHERE id=%s", (batch_id,))
        return self._item(item)

    @staticmethod
    async def _source_duration(connection, batch: dict[str, Any]) -> int:
        async with connection.cursor() as cursor:
            await cursor.execute("SELECT duration_ms FROM media_assets WHERE id=%s", (batch["source_media_asset_id"],))
            return int((await cursor.fetchone())["duration_ms"])

    async def update_item(self, actor, batch_id: UUID, item_id: UUID, request: UpdateItemRequest):
        async with self.database.transaction() as connection:
            batch = await self._load(connection, actor, batch_id, lock=True)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT * FROM clip_batch_items WHERE id=%s AND batch_id=%s AND deleted_at IS NULL FOR UPDATE",
                    (item_id, batch_id),
                )
                found = await cursor.fetchone()
                if found is None:
                    raise ClipBatchError("clip_batch_item_not_found", "Clip was not found", 404)
                item = dict(found)
                if item["revision"] != request.expectedRevision:
                    raise ClipBatchError("clip_item_revision_conflict", "Clip revision is stale", 409)
                start = request.sourceStartMs if request.sourceStartMs is not None else item["source_start_ms"]
                end = request.sourceEndMs if request.sourceEndMs is not None else item["source_end_ms"]
                if end <= start or end - start > min(MAX_CLIP_DURATION_MS, batch["maximum_clip_duration_ms"]):
                    raise ClipBatchError("clip_range_invalid", "Clip range must be between 1 and 180 seconds", 422)
                if end > await self._source_duration(connection, batch):
                    raise ClipBatchError("clip_range_out_of_bounds", "Clip range exceeds the source video", 422)
                if item["child_project_id"] and (start != item["source_start_ms"] or end != item["source_end_ms"]):
                    raise ClipBatchError("materialized_clip_range_locked", "Confirm resetting edits before changing this range", 409)
                values = {
                    "title": request.title if request.title is not None else item["title"],
                    "source_start_ms": start,
                    "source_end_ms": end,
                    "selected_for_export": request.selectedForExport if request.selectedForExport is not None else item["selected_for_export"],
                }
                await cursor.execute(
                    """UPDATE clip_batch_items SET title=%s,source_start_ms=%s,source_end_ms=%s,
                    selected_for_export=%s,revision=revision+1,updated_at=now() WHERE id=%s RETURNING *""",
                    (*values.values(), item_id),
                )
                item = dict(await cursor.fetchone())
                await cursor.execute("UPDATE clip_batches SET revision=revision+1,updated_at=now() WHERE id=%s", (batch_id,))
        return self._item(item)

    async def delete_item(self, actor, batch_id: UUID, item_id: UUID):
        async with self.database.transaction() as connection:
            await self._load(connection, actor, batch_id, lock=True)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "UPDATE clip_batch_items SET deleted_at=now(),revision=revision+1 WHERE id=%s AND batch_id=%s AND deleted_at IS NULL RETURNING id",
                    (item_id, batch_id),
                )
                if await cursor.fetchone() is None:
                    raise ClipBatchError("clip_batch_item_not_found", "Clip was not found", 404)
                await cursor.execute("UPDATE clip_batches SET revision=revision+1,updated_at=now() WHERE id=%s", (batch_id,))
        return {"deleted": True, "itemId": str(item_id)}

    async def reset_item_materialization(self, actor, batch_id: UUID, item_id: UUID):
        async with self.database.transaction() as connection:
            await self._load(connection, actor, batch_id, lock=True)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clip_batch_items SET child_project_id=NULL,child_project_revision=NULL,
                    status='draft',caption_status='not_requested',caption_job_id=NULL,
                    heading_status='not_requested',export_status='not_requested',metadata='{}'::jsonb,
                    revision=revision+1,updated_at=now()
                    WHERE id=%s AND batch_id=%s AND deleted_at IS NULL RETURNING *""",
                    (item_id, batch_id),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise ClipBatchError("clip_batch_item_not_found", "Clip was not found", 404)
                await cursor.execute("UPDATE clip_batches SET revision=revision+1,updated_at=now() WHERE id=%s", (batch_id,))
        return self._item(dict(row))

    async def cancel(self, actor, batch_id: UUID):
        async with self.database.transaction() as connection:
            await self._load(connection, actor, batch_id, lock=True)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "UPDATE clip_batches SET status='cancelled',deleted_at=now(),revision=revision+1,updated_at=now() WHERE id=%s",
                    (batch_id,),
                )
                await cursor.execute(
                    "UPDATE clip_batch_items SET status='cancelled',deleted_at=now(),revision=revision+1,updated_at=now() WHERE batch_id=%s AND deleted_at IS NULL",
                    (batch_id,),
                )
        return {"deleted": True, "batchId": str(batch_id), "sourceMediaPreserved": True}

    async def reorder(self, actor, batch_id: UUID, request: ReorderItemsRequest):
        async with self.database.transaction() as connection:
            batch = await self._load(connection, actor, batch_id, lock=True)
            if batch["revision"] != request.expectedBatchRevision:
                raise ClipBatchError("clip_batch_revision_conflict", "Clip batch revision is stale", 409)
            items = await self._items(connection, batch_id)
            if set(request.itemIds) != {item["id"] for item in items}:
                raise ClipBatchError("clip_reorder_invalid", "Reorder must include every active clip once", 422)
            async with connection.cursor() as cursor:
                await cursor.execute("UPDATE clip_batch_items SET ordinal=-ordinal WHERE batch_id=%s AND deleted_at IS NULL", (batch_id,))
                for ordinal, item_id in enumerate(request.itemIds, 1):
                    await cursor.execute("UPDATE clip_batch_items SET ordinal=%s,updated_at=now() WHERE id=%s", (ordinal, item_id))
                await cursor.execute("UPDATE clip_batches SET revision=revision+1,updated_at=now() WHERE id=%s RETURNING *", (batch_id,))
                batch = dict(await cursor.fetchone())
            items = await self._items(connection, batch_id)
        return self._batch(batch, [self._item(item) for item in items])

    async def set_source_project(self, actor, batch_id: UUID, project_id: str):
        async with self.database.transaction() as connection:
            batch = await self._load(connection, actor, batch_id, lock=True)
            if batch["source_project_id"] and batch["source_project_id"] != project_id:
                raise ClipBatchError("source_project_conflict", "Source editor project already exists", 409)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "UPDATE clip_batches SET source_project_id=%s,revision=revision+1,updated_at=now() WHERE id=%s RETURNING *",
                    (project_id, batch_id),
                )
                batch = dict(await cursor.fetchone())
            items = await self._items(connection, batch_id)
        return self._batch(batch, [self._item(item) for item in items])

    async def set_child_project(self, actor, batch_id: UUID, item_id: UUID, project_id: str, revision: int):
        async with self.database.transaction() as connection:
            batch = await self._load(connection, actor, batch_id, lock=True)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clip_batch_items SET child_project_id=COALESCE(child_project_id,%s),
                    child_project_revision=COALESCE(child_project_revision,%s),status='materializing',heading_status=%s,
                    revision=revision+1,updated_at=now()
                    WHERE id=%s AND batch_id=%s AND deleted_at IS NULL RETURNING *""",
                    (project_id, revision, "pending" if batch["headings_enabled"] else "not_requested", item_id, batch_id),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise ClipBatchError("clip_batch_item_not_found", "Clip was not found", 404)
                item = dict(row)
        return self._item(item)

    async def begin_caption(self, actor, batch_id: UUID, item_id: UUID) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            batch = await self._load(connection, actor, batch_id, lock=True)
            if not batch["captions_enabled"]:
                raise ClipBatchError("clip_captions_disabled", "Captions are disabled for this clip batch", 409)
            items = await self._items(connection, batch_id)
            item = next((value for value in items if value["id"] == item_id), None)
            if item is None:
                raise ClipBatchError("clip_batch_item_not_found", "Clip was not found", 404)
            if not item["child_project_id"]:
                raise ClipBatchError("clip_batch_not_materialized", "Create the clip project before generating captions", 409)
            active = next((value for value in items if value["id"] != item_id and value["caption_status"] in {"queued", "processing"}), None)
            if active:
                raise ClipBatchError("caption_batch_busy", "Another clip in this batch is generating captions", 409)
            if item.get("caption_job_id") and item["caption_status"] in {"queued", "processing", "completed"}:
                return item
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "UPDATE clip_batch_items SET caption_status='processing',updated_at=now() WHERE id=%s RETURNING *",
                    (item_id,),
                )
                return dict(await cursor.fetchone())

    async def set_caption_job(self, actor, batch_id: UUID, item_id: UUID, *, job_id: str | None, status: str) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            await self._load(connection, actor, batch_id, lock=True)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clip_batch_items SET caption_job_id=COALESCE(%s,caption_job_id),caption_status=%s,
                    revision=revision+1,updated_at=now() WHERE id=%s AND batch_id=%s AND deleted_at IS NULL RETURNING *""",
                    (job_id, status, item_id, batch_id),
                )
                row = await cursor.fetchone()
            if row is None:
                raise ClipBatchError("clip_batch_item_not_found", "Clip was not found", 404)
            return self._item(dict(row))

    async def sync_editor_project(self, actor, batch_id: UUID, item_id: UUID, *, expected_item_revision: int, project: dict[str, Any]):
        if len(json.dumps(project, separators=(",", ":"), ensure_ascii=False).encode()) > 16 * 1024 * 1024:
            raise ClipBatchError("editor_project_too_large", "The editable clip project exceeds its safe size", 413)
        ensure_portable_json(project, "editorProject")
        async with self.database.transaction() as connection:
            batch = await self._load(connection, actor, batch_id, lock=True)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT * FROM clip_batch_items WHERE id=%s AND batch_id=%s AND deleted_at IS NULL FOR UPDATE",
                    (item_id, batch_id),
                )
                found = await cursor.fetchone()
                if found is None:
                    raise ClipBatchError("clip_batch_item_not_found", "Clip was not found", 404)
                item = dict(found)
                if item["revision"] != expected_item_revision:
                    raise ClipBatchError("clip_item_revision_conflict", "Clip revision is stale", 409)
                project_id = item["child_project_id"]
                if not project_id or project.get("version") != 35 or (project.get("metadata") or {}).get("id") != project_id:
                    raise ClipBatchError("editor_project_invalid", "The editable clip project does not match this clip", 422)
                if collect_project_media_ids(project) != {str(batch["source_media_asset_id"])}:
                    raise ClipBatchError("editor_project_media_mismatch", "The editable clip references unexpected media", 422)
                await cursor.execute(
                    "SELECT revision,latest_conversion_result FROM clip_projects WHERE id=%s AND owner_user_id=%s FOR UPDATE",
                    (project_id, actor.user_id),
                )
                project_row = await cursor.fetchone()
                if project_row is None or project_row["revision"] != item["child_project_revision"]:
                    raise ClipBatchError("editor_project_revision_conflict", "The editable clip project is stale", 409)
                if (project.get("capinstaClippingProvenance") or {}).get("sourceClipProjectRevision") != project_row["revision"]:
                    raise ClipBatchError("editor_project_revision_conflict", "The editable clip project is stale", 409)
                conversion = dict(project_row["latest_conversion_result"] or {})
                if conversion.get("sourceClipProjectRevision") != project_row["revision"]:
                    raise ClipBatchError("editor_project_not_ready", "The editable clip project is not ready", 409)
                conversion["project"] = project
                identity = canonical_hash(conversion)
                await cursor.execute(
                    "UPDATE clip_projects SET latest_conversion_result=%s,latest_conversion_result_identity=%s,updated_at=now() WHERE id=%s",
                    (_json(conversion), identity, project_id),
                )
                await cursor.execute(
                    "UPDATE clip_batch_items SET heading_status=%s,revision=revision+1,updated_at=now() WHERE id=%s RETURNING *",
                    ("completed" if batch["headings_enabled"] else "not_requested", item_id),
                )
                return self._item(dict(await cursor.fetchone()))
