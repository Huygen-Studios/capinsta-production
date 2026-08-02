from __future__ import annotations

import asyncio
import hashlib
import json
import re
import shutil
import tempfile
import urllib.request
import zipfile
import aiosqlite
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from starlette.datastructures import Headers

from ..auth import current_user
from ..clip_batches.contracts import (
    CreateBatchRequest,
    BatchExportRequest,
    CaptionRequest,
    CreateItemRequest,
    MaterializeRequest,
    ReorderItemsRequest,
    SyncEditorProjectRequest,
    UpdateBatchRequest,
    UpdateItemRequest,
)
from ..clip_batches.errors import ClipBatchError
from ..clip_batches.repository import ClipBatchRepository
from ..clipping_orchestration.contracts import (
    CanvasInput,
    ConversionRequest,
    CreateProjectRequest,
    DeriveRequest,
)
from ..clipping_orchestration.errors import OrchestrationError
from ..clipping_orchestration.identity import validate_idempotency_key
from ..clipping_orchestration.repository import ClippingOrchestrationRepository
from ..clipping_persistence.database import DurableDatabase
from ..clipping_persistence.errors import PersistenceError
from ..clipping_persistence.models import AuthenticatedActor
from ..clipping_exports.config import ClippingExportConfig
from ..clipping_exports.contracts import ClippingExportRequestV1, ExportOptionsV1
from ..clipping_exports.errors import ClippingExportError
from ..clipping_exports.repository import ClippingExportRepository
from ..clipping_storage.config import MediaStorageConfig
from ..clipping_storage.errors import StorageError
from ..clipping_storage.local_storage import LocalMediaStorage
from ..clipping_storage.repository import MediaStorageRepository
from ..clipping_storage.provider import media_storage_for_provider
from ..database import DB_PATH
from ..durable_transcription.config import DurableTranscriptionConfig
from .jobs import create_job, get_job
from ai_pipeline.audio import extract_audio

router = APIRouter(prefix="/clipping/batches", tags=["clipping-batches"])


def _actor() -> AuthenticatedActor:
    return AuthenticatedActor.from_verified_user(current_user().id)


def _repositories():
    database = DurableDatabase()
    return ClipBatchRepository(database), ClippingOrchestrationRepository(database)


def _key(value: str) -> str:
    try:
        return validate_idempotency_key(value)
    except ValueError as exc:
        raise HTTPException(400, detail={"code": "invalid_idempotency_key", "message": "Idempotency-Key is invalid"}) from exc


def _raise(error: Exception) -> None:
    if isinstance(error, ClipBatchError):
        raise HTTPException(error.status_code, detail={"code": error.code, "message": error.message}) from error
    if isinstance(error, OrchestrationError):
        raise HTTPException(error.status_code, detail={"code": error.code, "message": error.message}) from error
    if isinstance(error, ClippingExportError):
        raise HTTPException(error.status_code, detail={"code": error.code, "message": error.safe_message}) from error
    if isinstance(error, StorageError):
        raise HTTPException(503, detail={"code": error.category, "message": error.message}) from error
    if isinstance(error, PersistenceError):
        status = 503 if error.category in {"database_unavailable", "transaction_failed"} else 422
        raise HTTPException(status, detail={"code": error.category, "message": error.message}) from error
    raise error


def _canvas(platform: str) -> CanvasInput:
    sizes = {
        "instagram_reels": (1080, 1920, "9:16"),
        "youtube_shorts": (1080, 1920, "9:16"),
        "tiktok": (1080, 1920, "9:16"),
        "custom": (1080, 1920, "custom"),
    }
    width, height, ratio = sizes[platform]
    return CanvasInput(aspectRatio=ratio, width=width, height=height, background="#000000")


def _range(*, range_id: str, media_id: str, start: int, end: int):
    return {
        "schemaVersion": 1,
        "id": range_id,
        "sourceMediaId": media_id,
        "sourceStartMs": start,
        "sourceEndMs": end,
        "order": 0,
        "playbackRate": 1,
        "selection": None,
        "boundary": {
            "preRollMs": 0,
            "postRollMs": 0,
            "startAdjustedManually": True,
            "endAdjustedManually": True,
        },
        "transitionIn": None,
        "transitionOut": None,
        "enabled": True,
        "label": None,
        "metadata": {"manualClip": True},
    }


async def _create_project(batch_repo, project_repo, actor, batch_id: UUID, *, item=None):
    context = await batch_repo.context(actor, batch_id)
    batch = context["batch"]
    media_id = str(batch["source_media_asset_id"])
    if item is None:
        start, end = 0, context["media"]["duration_ms"]
        title = batch["title"]
        token = "source"
        transcript_id = context["transcriptId"]
    else:
        start, end = item["source_start_ms"], item["source_end_ms"]
        title = item["title"]
        token = str(item["id"])
        transcript_id = await batch_repo.ensure_item_transcript(actor, batch_id, item["id"])
    metadata = {
        "clipBatchId": str(batch_id),
        "clipBatchItemId": str(item["id"]) if item else None,
        "manualClipSource": item is None,
    }
    if item is not None and batch["headings_enabled"]:
        metadata["automaticClipper"] = {
            "hookOverlay": {
                "text": "Add a heading",
                "supportingEmojis": [],
                "startMs": 0,
                "endMs": end - start,
                "position": "top",
            }
        }
    result = await project_repo.create_project(
        actor,
        CreateProjectRequest(
            mediaAssetId=batch["source_media_asset_id"],
            transcriptId=transcript_id,
            name=title,
            canvas=_canvas(batch["platform_preset"]),
            initialRanges=[_range(range_id=f"range_{token.replace('-', '')}", media_id=media_id, start=start, end=end)],
            metadata=metadata,
        ),
        idempotency_key=f"manual-batch:{batch_id}:{token}",
        maximum_ranges=1,
    )
    project = result["project"]
    project_id = project["clipProjectId"]
    revision = result["revision"]
    await project_repo.request_derivation(
        actor,
        project_id,
        DeriveRequest(expectedRevision=revision, includeRemappedTranscript=False),
        idempotency_key=f"manual-derive:{batch_id}:{token}:r{revision}",
    )
    return project_id, revision


@router.post("", status_code=201)
async def create_batch(body: CreateBatchRequest, idempotency_key: str = Header(alias="Idempotency-Key")):
    actor = _actor()
    batches, projects = _repositories()
    try:
        batch = await batches.create(actor, body, idempotency_key=_key(idempotency_key))
        if not batch["sourceProjectId"]:
            project_id, _ = await _create_project(batches, projects, actor, UUID(batch["id"]))
            batch = await batches.set_source_project(actor, UUID(batch["id"]), project_id)
        return batch
    except (ClipBatchError, ClippingExportError, OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.get("/{batch_id}")
async def get_batch(batch_id: UUID):
    try:
        batches, _ = _repositories()
        return await batches.get(_actor(), batch_id)
    except (ClipBatchError, PersistenceError, StorageError) as error:
        _raise(error)


@router.patch("/{batch_id}")
async def update_batch(batch_id: UUID, body: UpdateBatchRequest):
    try:
        batches, _ = _repositories()
        return await batches.update(_actor(), batch_id, body)
    except (ClipBatchError, PersistenceError, StorageError) as error:
        _raise(error)


@router.delete("/{batch_id}")
async def delete_batch(batch_id: UUID):
    try:
        batches, _ = _repositories()
        return await batches.cancel(_actor(), batch_id)
    except (ClipBatchError, PersistenceError) as error:
        _raise(error)


@router.post("/{batch_id}/items", status_code=201)
async def create_item(batch_id: UUID, body: CreateItemRequest):
    try:
        batches, _ = _repositories()
        return await batches.add_item(_actor(), batch_id, body)
    except (ClipBatchError, PersistenceError) as error:
        _raise(error)


@router.patch("/{batch_id}/items/{item_id}")
async def update_item(batch_id: UUID, item_id: UUID, body: UpdateItemRequest):
    try:
        batches, _ = _repositories()
        return await batches.update_item(_actor(), batch_id, item_id, body)
    except (ClipBatchError, PersistenceError) as error:
        _raise(error)


@router.delete("/{batch_id}/items/{item_id}")
async def delete_item(batch_id: UUID, item_id: UUID):
    actor = _actor()
    batches, projects = _repositories()
    try:
        context = await batches.context(actor, batch_id)
        item = next((value for value in context["items"] if value["id"] == item_id), None)
        if item is None:
            raise ClipBatchError("clip_batch_item_not_found", "Clip was not found", 404)
        if item["child_project_id"]:
            await projects.lifecycle(
                actor,
                item["child_project_id"],
                delete=True,
                idempotency_key=f"manual-clip-delete:{batch_id}:{item_id}",
            )
        return await batches.delete_item(actor, batch_id, item_id)
    except (ClipBatchError, OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.post("/{batch_id}/items/{item_id}/reset-materialization")
async def reset_item_materialization(batch_id: UUID, item_id: UUID):
    actor = _actor()
    batches, projects = _repositories()
    try:
        context = await batches.context(actor, batch_id)
        item = next((value for value in context["items"] if value["id"] == item_id), None)
        if item is None:
            raise ClipBatchError("clip_batch_item_not_found", "Clip was not found", 404)
        if item["child_project_id"]:
            await projects.lifecycle(
                actor,
                item["child_project_id"],
                delete=True,
                idempotency_key=f"manual-clip-reset:{batch_id}:{item_id}",
            )
        return await batches.reset_item_materialization(actor, batch_id, item_id)
    except (ClipBatchError, OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.post("/{batch_id}/items/reorder")
async def reorder_items(batch_id: UUID, body: ReorderItemsRequest):
    try:
        batches, _ = _repositories()
        return await batches.reorder(_actor(), batch_id, body)
    except (ClipBatchError, PersistenceError) as error:
        _raise(error)


@router.post("/{batch_id}/materialize", status_code=202)
async def materialize(batch_id: UUID, body: MaterializeRequest, idempotency_key: str = Header(alias="Idempotency-Key")):
    _key(idempotency_key)
    actor = _actor()
    batches, projects = _repositories()
    try:
        context = await batches.context(actor, batch_id)
        if context["batch"]["revision"] != body.expectedRevision:
            raise ClipBatchError("clip_batch_revision_conflict", "Clip batch revision is stale", 409)
        if not context["items"]:
            raise ClipBatchError("clip_batch_empty", "Create at least one clip range", 422)
        output = []
        for item in context["items"]:
            if item["child_project_id"]:
                output.append(batches._item(item))
                continue
            project_id, revision = await _create_project(batches, projects, actor, batch_id, item=item)
            output.append(await batches.set_child_project(actor, batch_id, item["id"], project_id, revision))
        return {"batchId": str(batch_id), "items": output, "status": "materializing"}
    except (ClipBatchError, ClippingExportError, OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.post("/{batch_id}/captions", status_code=202)
async def create_batch_caption(batch_id: UUID, body: CaptionRequest, request: Request):
    actor = _actor()
    database = DurableDatabase()
    batches = ClipBatchRepository(database)
    item = None
    try:
        item = await batches.begin_caption(actor, batch_id, body.itemId)
        if item.get("caption_job_id"):
            return {"job_id": item["caption_job_id"], "status": item["caption_status"], "replayed": True}
        context = await batches.context(actor, batch_id)
        asset = await MediaStorageRepository(database).get_asset(actor, context["batch"]["source_media_asset_id"])
        storage_config = MediaStorageConfig.from_env()
        storage = media_storage_for_provider(asset.get("storage_provider"), storage_config)
        temp_root = DurableTranscriptionConfig.from_env().temp_root.resolve()
        temp_root.mkdir(parents=True, exist_ok=True)
        async with storage.open_probe_source(
            bucket=asset["storage_bucket"],
            path=asset["storage_path"],
            expires_in=min(storage_config.maximum_url_ttl_seconds, 900),
        ) as source:
            with tempfile.TemporaryDirectory(prefix="clip-caption-", dir=temp_root) as root:
                audio_path = Path(root) / "selected-range.wav"
                await asyncio.to_thread(
                    extract_audio,
                    source.value,
                    str(audio_path),
                    start_ms=item["source_start_ms"],
                    end_ms=item["source_end_ms"],
                )
                handle = audio_path.open("rb")
                upload = UploadFile(
                    file=handle,
                    size=audio_path.stat().st_size,
                    filename="selected-range.wav",
                    headers=Headers({"content-type": "audio/wav"}),
                )
                created = await create_job(
                    request=request,
                    languageMode=body.languageMode,
                    target_lang=None,
                    audioLanguage=None,
                    sourceLanguage=None,
                    captionOutput="original",
                    outputLanguage=None,
                    project_id=item["child_project_id"],
                    media_asset_id=None,
                    file=upload,
                    source_in_ms=None,
                    source_out_ms=None,
                    timeline_offset_ms=0,
                    timeline_offset_us=0,
                    timeline_duration_us=(item["source_end_ms"] - item["source_start_ms"]) * 1000,
                    audio_origin="rendered_selection",
                )
        await batches.set_caption_job(actor, batch_id, body.itemId, job_id=created.job_id, status="queued")
        return {"job_id": created.job_id, "status": created.status, "replayed": False}
    except (ClipBatchError, PersistenceError, StorageError) as error:
        if item is not None:
            await batches.set_caption_job(actor, batch_id, body.itemId, job_id=None, status="failed")
        _raise(error)
    except HTTPException:
        if item is not None:
            await batches.set_caption_job(actor, batch_id, body.itemId, job_id=None, status="failed")
        raise
    except Exception as error:
        if item is not None:
            await batches.set_caption_job(actor, batch_id, body.itemId, job_id=None, status="failed")
        raise HTTPException(
            503,
            detail={"code": "caption_range_preparation_failed", "message": "The selected clip audio could not be prepared"},
        ) from error


@router.get("/{batch_id}/captions/{item_id}")
async def batch_caption_status(batch_id: UUID, item_id: UUID, response: Response):
    actor = _actor()
    database = DurableDatabase()
    batches = ClipBatchRepository(database)
    projects = ClippingOrchestrationRepository(database)
    context = await batches.context(actor, batch_id)
    item = next((value for value in context["items"] if value["id"] == item_id), None)
    if item is None or not item.get("caption_job_id"):
        raise HTTPException(404, detail={"code": "caption_job_not_found", "message": "Caption job was not found"})
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        job = await get_job(item["caption_job_id"], response, db)
    previous_status = item["caption_status"]
    status = job.status if job.status in {"failed", "cancelled"} else "processing"
    if job.status == "completed":
        try:
            status = await _advance_completed_caption(
                batches, projects, actor, batch_id, item_id, job.job_id, job.transcript or {"segments": []}
            )
        except (ClipBatchError, OrchestrationError, PersistenceError) as error:
            if isinstance(error, ClipBatchError):
                await batches.set_caption_job(actor, batch_id, item_id, job_id=job.job_id, status="failed")
            _raise(error)
    if status != previous_status:
        await batches.set_caption_job(actor, batch_id, item_id, job_id=job.job_id, status=status)
    return {**job.model_dump(mode="json"), "status": status}


async def _advance_completed_caption(batches, projects, actor, batch_id, item_id, job_id, transcript):
    item = await batches.persist_caption_transcript(
        actor, batch_id, item_id, job_id=job_id, transcript=transcript
    )
    revision = item["childProjectRevision"]
    project_id = item["childProjectId"]
    project_status = await projects.get_detail(actor, project_id)
    if project_status["derived"]["remappedTranscriptStatus"] != "current":
        requested = await projects.request_derivation(
            actor,
            project_id,
            DeriveRequest(expectedRevision=revision, includeRemappedTranscript=True),
            idempotency_key=f"manual-caption-derive:{batch_id}:{item_id}:{job_id}:r{revision}",
        )
        return "failed" if requested["status"] in {"failed", "cancelled"} else "processing"
    if project_status["derived"]["conversionStatus"] != "current":
        requested = await projects.request_conversion(
            actor,
            project_id,
            ConversionRequest(expectedRevision=revision, targetProjectId=project_id, includeCaptions=True),
            idempotency_key=f"manual-caption-convert:{batch_id}:{item_id}:{job_id}:r{revision}",
        )
        return "failed" if requested["status"] in {"failed", "cancelled"} else "processing"
    return "completed"


def _filename(title: str, ordinal: int) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", title).strip(".-")[:80] or "clip"
    return f"clip-{ordinal:02d}-{safe}.mp4"


async def _batch_export(database, actor, batch_id: UUID, export_id: UUID):
    async with database.connection() as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                "SELECT * FROM clip_batch_exports WHERE id=%s AND batch_id=%s AND owner_user_id=%s AND deleted_at IS NULL",
                (export_id, batch_id, actor.user_id),
            )
            row = await cursor.fetchone()
            if row is None:
                raise ClipBatchError("clip_batch_export_not_found", "Batch export was not found", 404)
            export = dict(row)
            await cursor.execute(
                """SELECT bei.*,ce.status,ce.failure,ce.size_bytes,ce.duration_ms
                FROM clip_batch_export_items bei JOIN clipping_exports ce ON ce.id=bei.clipping_export_id
                WHERE bei.batch_export_id=%s ORDER BY bei.ordinal""",
                (export_id,),
            )
            items = [dict(item) for item in await cursor.fetchall()]
    statuses = [item["status"] for item in items]
    status = export["status"]
    if status == "processing":
        status = "partial_failure" if any(value in {"failed", "cancelled"} for value in statuses) else ("ready_for_zip" if statuses and all(value == "ready" for value in statuses) else "processing")
    return {
        "schemaVersion": 1,
        "id": str(export["id"]),
        "batchId": str(export["batch_id"]),
        "status": status,
        "items": [
            {
                "itemId": str(item["clip_batch_item_id"]),
                "exportId": str(item["clipping_export_id"]),
                "ordinal": item["ordinal"],
                "filename": item["filename"],
                "status": item["status"],
            }
            for item in items
        ],
        "readyAt": export["ready_at"].isoformat() if export["ready_at"] else None,
    }


@router.post("/{batch_id}/exports", status_code=201)
async def create_batch_export(batch_id: UUID, body: BatchExportRequest, idempotency_key: str = Header(alias="Idempotency-Key")):
    key = _key(idempotency_key)
    actor = _actor()
    database = DurableDatabase()
    batches = ClipBatchRepository(database)
    try:
        context = await batches.context(actor, batch_id)
        requested = set(body.itemIds or [])
        items = [item for item in context["items"] if (item["id"] in requested if requested else item["selected_for_export"])]
        if not items or (requested and requested != {item["id"] for item in items}):
            raise ClipBatchError("clip_batch_export_empty", "Select at least one materialized clip", 422)
        if any(not item["child_project_id"] or not item["child_project_revision"] for item in items):
            raise ClipBatchError("clip_batch_not_materialized", "Selected clips must be created before export", 409)
        if context["batch"]["captions_enabled"] and any(
            item["caption_status"] in {"queued", "processing"} for item in items
        ):
            raise ClipBatchError(
                "clip_captions_not_ready",
                "Selected clip captions must finish before export",
                409,
            )
        request_hash = hashlib.sha256(json.dumps(sorted(str(item["id"]) for item in items)).encode()).hexdigest()
        async with database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT id,request_hash FROM clip_batch_exports WHERE owner_user_id=%s AND batch_id=%s AND idempotency_key=%s",
                    (actor.user_id, batch_id, key),
                )
                existing = await cursor.fetchone()
        if existing:
            if existing["request_hash"] != request_hash:
                raise ClipBatchError("idempotency_conflict", "Idempotency key was used with different clips", 409)
            return await _batch_export(database, actor, batch_id, existing["id"])
        export_config = ClippingExportConfig.from_env()
        export_repo = ClippingExportRepository(database, export_config)
        created = []
        for item in items:
            result = await export_repo.create(
                actor,
                item["child_project_id"],
                ClippingExportRequestV1(
                    expectedProjectRevision=item["child_project_revision"],
                    options=ExportOptionsV1(includeCaptions=item["caption_status"] == "completed"),
                ),
                idempotency_key=f"batch-export:{batch_id}:{item['id']}:r{item['child_project_revision']}",
            )
            created.append((item, UUID(result["exportId"])))
        export_id = uuid4()
        async with database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "INSERT INTO clip_batch_exports(id,owner_user_id,batch_id,idempotency_key,request_hash) VALUES (%s,%s,%s,%s,%s)",
                    (export_id, actor.user_id, batch_id, key, request_hash),
                )
                for item, clipping_export_id in created:
                    await cursor.execute(
                        "INSERT INTO clip_batch_export_items(batch_export_id,clip_batch_item_id,clipping_export_id,ordinal,filename) VALUES (%s,%s,%s,%s,%s)",
                        (export_id, item["id"], clipping_export_id, item["ordinal"], _filename(item["title"], item["ordinal"])),
                    )
        return await _batch_export(database, actor, batch_id, export_id)
    except (ClipBatchError, ClippingExportError, OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.put("/{batch_id}/items/{item_id}/editor-project")
async def sync_editor_project(batch_id: UUID, item_id: UUID, body: SyncEditorProjectRequest):
    try:
        batches, _ = _repositories()
        return await batches.sync_editor_project(
            _actor(),
            batch_id,
            item_id,
            expected_item_revision=body.expectedItemRevision,
            project=body.project,
        )
    except (ClipBatchError, PersistenceError) as error:
        _raise(error)


@router.get("/{batch_id}/exports/{export_id}")
async def batch_export_status(batch_id: UUID, export_id: UUID):
    try:
        return await _batch_export(DurableDatabase(), _actor(), batch_id, export_id)
    except (ClipBatchError, PersistenceError, StorageError) as error:
        _raise(error)


@router.post("/{batch_id}/exports/{export_id}/finalize")
async def finalize_batch_export(batch_id: UUID, export_id: UUID):
    actor = _actor()
    database = DurableDatabase()
    claimed = False
    try:
        status = await _batch_export(database, actor, batch_id, export_id)
        if status["status"] == "ready":
            return status
        if status["status"] != "ready_for_zip":
            raise ClipBatchError("clip_batch_export_not_ready", "Selected clip exports are not ready", 409)
        async with database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clip_batch_exports SET status='zipping',updated_at=now()
                    WHERE id=%s AND batch_id=%s AND owner_user_id=%s AND status='processing' RETURNING id""",
                    (export_id, batch_id, actor.user_id),
                )
                claimed = await cursor.fetchone() is not None
        if not claimed:
            raise ClipBatchError("clip_batch_export_not_ready", "Selected clip exports are already being prepared", 409)
        config = ClippingExportConfig.from_env()
        storage_config = MediaStorageConfig.from_env()
        config.temp_root.mkdir(parents=True, exist_ok=True)
        manifest_items = []
        with tempfile.TemporaryDirectory(prefix="batch-zip-", dir=config.temp_root) as root:
            root_path = Path(root)
            async with database.connection() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """SELECT bei.*,ce.*,cbi.source_start_ms,cbi.source_end_ms,cbi.title
                        FROM clip_batch_export_items bei
                        JOIN clipping_exports ce ON ce.id=bei.clipping_export_id
                        JOIN clip_batch_items cbi ON cbi.id=bei.clip_batch_item_id
                        WHERE bei.batch_export_id=%s ORDER BY bei.ordinal""",
                        (export_id,),
                    )
                    rows = [dict(row) for row in await cursor.fetchall()]
            archive = root_path / "clips.zip"
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
                for row in rows:
                    storage = media_storage_for_provider(row.get("storage_provider"), storage_config)
                    local = root_path / row["filename"]
                    if isinstance(storage, LocalMediaStorage):
                        await asyncio.to_thread(
                            shutil.copyfile,
                            storage._path(row["storage_bucket"], row["storage_path"]),
                            local,
                        )
                    else:
                        url = await storage.create_read_url(bucket=row["storage_bucket"], path=row["storage_path"], expires_in=config.download_ttl_seconds)
                        await asyncio.to_thread(urllib.request.urlretrieve, url, local)
                    output.write(local, arcname=row["filename"])
                    manifest_items.append({
                        "itemId": str(row["clip_batch_item_id"]), "exportId": str(row["clipping_export_id"]),
                        "order": row["ordinal"], "title": row["title"], "sourceStartMs": row["source_start_ms"],
                        "sourceEndMs": row["source_end_ms"], "outputDurationMs": row["duration_ms"], "filename": row["filename"],
                    })
                manifest = {
                    "schemaVersion": 1, "batchId": str(batch_id),
                    "sourceMediaAssetId": str((await ClipBatchRepository(database).context(actor, batch_id))["batch"]["source_media_asset_id"]),
                    "exportedAt": datetime.now(timezone.utc).isoformat(), "items": manifest_items,
                }
                output.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
            with archive.open("rb") as source:
                checksum = hashlib.file_digest(source, "sha256").hexdigest()
            storage = media_storage_for_provider(storage_config.storage_provider, storage_config)
            path = f"{actor.user_id}/clip-batches/{batch_id}/{export_id}.zip"
            uploaded = await storage.upload_file(
                bucket=storage_config.exports_bucket, path=path, local_path=archive,
                content_type="application/zip", maximum_bytes=config.maximum_output_bytes * max(1, len(rows)), checksum=checksum,
            )
        async with database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """UPDATE clip_batch_exports SET status='ready',manifest=%s,storage_provider=%s,
                    storage_bucket=%s,storage_path=%s,size_bytes=%s,checksum=%s,ready_at=now(),updated_at=now()
                    WHERE id=%s AND owner_user_id=%s""",
                    (json.dumps(manifest), storage_config.storage_provider, storage_config.exports_bucket, path, uploaded.size_bytes, checksum, export_id, actor.user_id),
                )
        return await _batch_export(database, actor, batch_id, export_id)
    except Exception as error:
        if claimed:
            async with database.transaction() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        "UPDATE clip_batch_exports SET status='processing',updated_at=now() WHERE id=%s AND owner_user_id=%s AND status='zipping'",
                        (export_id, actor.user_id),
                    )
        if isinstance(error, (ClipBatchError, PersistenceError, StorageError)):
            _raise(error)
        raise


@router.get("/{batch_id}/exports/{export_id}/download")
async def download_batch_export(batch_id: UUID, export_id: UUID, request: Request):
    actor = _actor()
    database = DurableDatabase()
    try:
        await _batch_export(database, actor, batch_id, export_id)
        async with database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT * FROM clip_batch_exports WHERE id=%s AND owner_user_id=%s AND status='ready'", (export_id, actor.user_id))
                row = await cursor.fetchone()
        if row is None:
            raise ClipBatchError("clip_batch_export_not_ready", "Batch ZIP is not ready", 409)
        value = dict(row)
        storage_config = MediaStorageConfig.from_env()
        storage = media_storage_for_provider(value.get("storage_provider"), storage_config)
        url = (
            str(request.base_url).rstrip("/") + f"/api/clipping/batches/{batch_id}/exports/{export_id}/content"
            if isinstance(storage, LocalMediaStorage)
            else await storage.create_download_url(
                bucket=value["storage_bucket"], path=value["storage_path"], expires_in=ClippingExportConfig.from_env().download_ttl_seconds,
                filename=f"clip-batch-{batch_id}.zip",
            )
        )
        return {"exportId": str(export_id), "url": url}
    except (ClipBatchError, PersistenceError, StorageError) as error:
        _raise(error)


@router.get("/{batch_id}/exports/{export_id}/content")
async def local_batch_export_content(batch_id: UUID, export_id: UUID):
    actor = _actor()
    database = DurableDatabase()
    try:
        await _batch_export(database, actor, batch_id, export_id)
        async with database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT * FROM clip_batch_exports WHERE id=%s AND batch_id=%s AND owner_user_id=%s AND status='ready'",
                    (export_id, batch_id, actor.user_id),
                )
                row = await cursor.fetchone()
        if row is None:
            raise ClipBatchError("clip_batch_export_not_ready", "Batch ZIP is not ready", 409)
        storage_config = MediaStorageConfig.from_env()
        storage = media_storage_for_provider(dict(row).get("storage_provider"), storage_config)
        if not isinstance(storage, LocalMediaStorage):
            raise HTTPException(404, detail={"code": "local_storage_disabled"})
        value = dict(row)
        return FileResponse(
            storage._path(value["storage_bucket"], value["storage_path"]),
            media_type="application/zip",
            filename=f"clip-batch-{batch_id}.zip",
        )
    except (ClipBatchError, PersistenceError, StorageError) as error:
        _raise(error)
