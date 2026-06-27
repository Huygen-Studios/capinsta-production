import asyncio
import json
import os
import secrets
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..admin_auth import require_backend_admin_permission
from ..database import get_db
from ..operational_mirror import (
    mirror_caption_job,
    mirror_export_job,
    reconcile_runtime_jobs,
    sanitize_error,
)
from ..progress import manager
from ..settings import EXPORT_DIR, MEDIA_DIR
from ..storage_paths import resolve_existing_file_inside
from ..worker_startup import start_pipeline_worker
from ..project_cleanup import ACTIVE_JOB_STATUSES
from ..project_deletion import delete_project_resources
from ..runtime_policy import project_retention_state
from ..transcription_catalog import model_runtime_availability, public_catalog, validate_catalog_selection
from ..transcription_control import (
    TranscriptionConfigSnapshot,
    bundled_test_audio_path,
    circuit_state,
    invalidate_transcription_config_cache,
)
from ai_pipeline.aligner import align_text
from ai_pipeline.config import MODEL_ALIGN_EN
from ai_pipeline.pipeline_config import DEFAULT_PIPELINE_OPTIONS, resolve_pipeline_config
from ai_pipeline.sync.stable_refine import apply_stable_refinement
from . import export_jobs as export_runtime
from ai_pipeline.transcriber import TranscriptionProviderError, is_real_secret, transcribe_audio

router = APIRouter(prefix="/admin", tags=["admin"])
internal_router = APIRouter(prefix="/internal/admin", tags=["internal-admin"])


async def _admin_source_media_path(db: aiosqlite.Connection, source_row: aiosqlite.Row) -> str:
    media_asset_id = source_row["media_asset_id"] if "media_asset_id" in source_row.keys() else None
    if not media_asset_id:
        raise HTTPException(status_code=410, detail="Source media requires migration before retry.")
    media = await (
        await db.execute(
            """
            SELECT * FROM media_assets
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (media_asset_id, source_row["user_id"]),
        )
    ).fetchone()
    if not media:
        raise HTTPException(status_code=410, detail="Source media is no longer available.")
    expected = (MEDIA_DIR / str(media["user_id"]) / str(media["project_id"]) / str(media["id"])).resolve()
    try:
        actual = resolve_existing_file_inside(MEDIA_DIR, media["storage_path"], label="media asset")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=410, detail="Source media is no longer available.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="Invalid media storage path.") from exc
    if actual != expected:
        raise HTTPException(status_code=410, detail="Source media requires migration before retry.")
    return str(actual)


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=8, max_length=1000)


class TranscriptionTestRequest(BaseModel):
    configurationId: str = Field(min_length=1, max_length=100)
    provider: str = Field(min_length=1, max_length=30)
    model: str = Field(min_length=1, max_length=120)
    version: int = Field(ge=1)
    timestampStrategy: str = Field(min_length=1, max_length=80)
    strictProvider: bool = True
    providerOptions: dict = Field(default_factory=dict)
    pipelineOptions: dict = Field(default_factory=dict)
    reason: str = Field(min_length=8, max_length=1000)


def _idempotency_key(request: Request) -> str:
    value = request.headers.get("idempotency-key", "").strip()
    if not value or len(value) > 160:
        raise HTTPException(status_code=400, detail="Idempotency-Key is required")
    return value


async def _existing_result(db: aiosqlite.Connection, request: Request, action: str, target_id: str):
    key = _idempotency_key(request)
    cursor = await db.execute(
        "SELECT action, target_id, result_json FROM admin_idempotency WHERE idempotency_key = ?",
        (key,),
    )
    row = await cursor.fetchone()
    if row:
        if row["action"] != action or row["target_id"] != target_id:
            raise HTTPException(status_code=409, detail="Idempotency key conflict")
        return json.loads(row["result_json"] or "{}")
    return None


async def _remember_result(
    db: aiosqlite.Connection,
    request: Request,
    action: str,
    target_id: str,
    result: dict,
):
    await db.execute(
        """
        INSERT INTO admin_idempotency (idempotency_key, action, target_id, result_json)
        VALUES (?, ?, ?, ?)
        """,
        (_idempotency_key(request), action, target_id, json.dumps(result)),
    )
    await db.commit()


@router.get("/jobs")
async def list_admin_jobs(
    request: Request,
    limit: int = 50,
    db: aiosqlite.Connection = Depends(get_db),
):
    admin = require_backend_admin_permission(request, "caption_jobs.read")
    cursor = await db.execute(
        """
        SELECT id, user_id, project_id, status, progress, filename, target_lang,
               created_at, completed_at, last_seen_at, expires_at, retry_count,
               retry_of_job_id, admin_retry_by, correlation_id
        FROM jobs ORDER BY created_at DESC LIMIT ?
        """,
        (max(1, min(limit, 100)),),
    )
    return {"correlationId": admin.correlation_id, "items": [dict(row) for row in await cursor.fetchall()]}


@router.get("/exports")
async def list_admin_exports(
    request: Request,
    limit: int = 50,
    db: aiosqlite.Connection = Depends(get_db),
):
    admin = require_backend_admin_permission(request, "exports.read")
    cursor = await db.execute(
        """
        SELECT id, user_id, project_id, source_job_id, status, stage, progress,
               filename, bytes, duration, width, height, fps, created_at,
               updated_at, expires_at, retry_count, retry_of_export_id,
               admin_retry_by, correlation_id
        FROM export_jobs ORDER BY created_at DESC LIMIT ?
        """,
        (max(1, min(limit, 100)),),
    )
    return {"correlationId": admin.correlation_id, "items": [dict(row) for row in await cursor.fetchall()]}


@router.post("/jobs/{job_id}/cancel")
async def cancel_admin_job(
    job_id: str,
    body: ReasonRequest,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    admin = require_backend_admin_permission(request, "caption_jobs.cancel")
    existing = await _existing_result(db, request, "caption.cancel", job_id)
    if existing is not None:
        return existing
    cursor = await db.execute(
        """
        UPDATE jobs SET status = 'cancelled', progress = -1,
          error = 'Cancelled by administrator', completed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status NOT IN ('completed','failed','cancelled','expired','closed')
        """,
        (job_id,),
    )
    if cursor.rowcount != 1:
        current = await (await db.execute("SELECT status FROM jobs WHERE id = ?", (job_id,))).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Job not found")
        if current["status"] != "cancelled":
            raise HTTPException(status_code=409, detail="Job is no longer cancellable")
    await db.commit()
    await manager.broadcast_progress(job_id, "cancelled", -1, "Cancelled by administrator.")
    await mirror_caption_job(job_id)
    result = {"ok": True, "status": "cancelled", "correlationId": admin.correlation_id}
    await _remember_result(db, request, "caption.cancel", job_id, result)
    return result


@router.post("/jobs/{job_id}/retry")
async def retry_admin_job(
    job_id: str,
    body: ReasonRequest,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    admin = require_backend_admin_permission(request, "caption_jobs.retry")
    existing = await _existing_result(db, request, "caption.retry", job_id)
    if existing is not None:
        return existing
    row = await (await db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    if row["status"] not in {"failed", "closed"}:
        raise HTTPException(status_code=409, detail="Only failed or closed jobs can be retried")
    retry_id = str(uuid.uuid4())
    source = await _admin_source_media_path(db, row)
    now = datetime.now(timezone.utc).isoformat()
    correlation_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    await db.execute(
        """
        INSERT INTO jobs (
          id, status, progress, filename, target_lang, created_at, last_seen_at,
          expires_at, user_id, project_id, retry_count, retry_of_job_id,
          admin_retry_by, correlation_id
        ) VALUES (?, 'queued', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            retry_id,
            row["filename"],
            row["target_lang"],
            now,
            now,
            row["expires_at"],
            row["user_id"],
            row["project_id"] or row["id"],
            int(row["retry_count"] or 0) + 1,
            job_id,
            admin.user_id,
            correlation_id,
        ),
    )
    await db.commit()
    await mirror_caption_job(retry_id)
    start_pipeline_worker(job_id=retry_id, file_path=source, language_mode=row["target_lang"])
    result = {"ok": True, "jobId": retry_id, "correlationId": admin.correlation_id}
    await _remember_result(db, request, "caption.retry", job_id, result)
    return result


@router.post("/jobs/{job_id}/close")
async def close_admin_job(
    job_id: str,
    body: ReasonRequest,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    admin = require_backend_admin_permission(request, "caption_jobs.cancel")
    existing = await _existing_result(db, request, "caption.close", job_id)
    if existing is not None:
        return existing
    cursor = await db.execute(
        "UPDATE jobs SET status = 'closed' WHERE id = ? AND status = 'failed'",
        (job_id,),
    )
    if cursor.rowcount != 1:
        raise HTTPException(status_code=409, detail="Only failed jobs can be closed")
    await db.commit()
    await mirror_caption_job(job_id)
    result = {"ok": True, "status": "closed", "correlationId": admin.correlation_id}
    await _remember_result(db, request, "caption.close", job_id, result)
    return result


@router.get("/jobs/{job_id}/diagnostics")
async def caption_diagnostics(
    job_id: str,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    admin = require_backend_admin_permission(request, "caption_jobs.download_diagnostics")
    row = await (await db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return JSONResponse(
        {
            "jobId": job_id,
            "status": row["status"],
            "progress": row["progress"],
            "language": row["target_lang"],
            "error": sanitize_error(row["error"]),
            "correlationId": row["correlation_id"] or admin.correlation_id,
            "createdAt": row["created_at"],
            "completedAt": row["completed_at"],
        },
        headers={"Content-Disposition": f'attachment; filename="caption-job-{job_id}-diagnostics.json"'},
    )


@router.post("/exports/{export_id}/cancel")
async def cancel_admin_export(
    export_id: str,
    body: ReasonRequest,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    admin = require_backend_admin_permission(request, "exports.cancel")
    existing = await _existing_result(db, request, "export.cancel", export_id)
    if existing is not None:
        return existing
    row = await (await db.execute("SELECT status FROM export_jobs WHERE id = ?", (export_id,))).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Export not found")
    if row["status"] not in {"queued", "running"}:
        if row["status"] == "cancelled":
            return {"ok": True, "status": "cancelled", "correlationId": admin.correlation_id}
        raise HTTPException(status_code=409, detail="Export is no longer cancellable")
    await db.execute(
        """
        UPDATE export_jobs SET status = 'cancelled', stage = 'cancelled',
          progress = -1, message = 'Cancelled by administrator',
          error = 'Cancelled by administrator', updated_at = ?
        WHERE id = ?
        """,
        (datetime.now(timezone.utc).isoformat(), export_id),
    )
    await db.commit()
    async with export_runtime._jobs_lock:
        if export_id in export_runtime._jobs:
            export_runtime._jobs[export_id].status = "cancelled"
            export_runtime._jobs[export_id].stage = "cancelled"
            export_runtime._jobs[export_id].progress = -1
    await mirror_export_job(export_id)
    result = {"ok": True, "status": "cancelled", "correlationId": admin.correlation_id}
    await _remember_result(db, request, "export.cancel", export_id, result)
    return result


@router.post("/exports/{export_id}/retry")
async def retry_admin_export(
    export_id: str,
    body: ReasonRequest,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    admin = require_backend_admin_permission(request, "exports.retry")
    existing = await _existing_result(db, request, "export.retry", export_id)
    if existing is not None:
        return existing
    row = await (await db.execute("SELECT * FROM export_jobs WHERE id = ?", (export_id,))).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Export not found")
    if row["status"] not in {"failed", "cancelled", "expired"}:
        raise HTTPException(status_code=409, detail="Export is not retryable")
    try:
        immutable = json.loads(row["immutable_input_json"] or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=409, detail="Immutable render input is unavailable") from exc
    if not immutable:
        raise HTTPException(status_code=409, detail="Immutable render input is unavailable")
    source_row = await (await db.execute("SELECT * FROM jobs WHERE id = ?", (row["source_job_id"],))).fetchone()
    if not source_row:
        raise HTTPException(status_code=409, detail="Source caption job is unavailable")
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    retry = export_runtime.ExportJobStatus(
        id=new_id,
        source_job_id=row["source_job_id"],
        status="queued",
        stage="queued",
        progress=0,
        message="Administrative retry queued.",
        duration=row["duration"],
        width=row["width"],
        height=row["height"],
        fps=row["fps"],
        expires_at=row["expires_at"],
        user_id=row["user_id"],
        project_id=row["project_id"] or row["source_job_id"],
        mode=row["mode"],
        retry_count=int(row["retry_count"] or 0) + 1,
        retry_of_export_id=export_id,
        admin_retry_by=admin.user_id,
        correlation_id=request.headers.get("x-correlation-id") or str(uuid.uuid4()),
        immutable_input=immutable,
        created_at=now,
        updated_at=now,
    )
    await export_runtime._persist_job(retry)
    export_request = export_runtime.ExportRequest(
        source_job_id=immutable["source_job_id"],
        captions_json=immutable.get("captions_json", "[]"),
        theme=immutable.get("theme", "word_highlight_box"),
        style_config_json=immutable.get("style_config_json"),
        resolution=immutable.get("resolution", "1080p"),
        export_width=immutable.get("export_width"),
        export_height=immutable.get("export_height"),
        export_fps=int(immutable.get("export_fps", 30)),
        include_audio=bool(immutable.get("include_audio", True)),
        quality=immutable.get("quality", "standard"),
        bitrate=immutable.get("bitrate", "auto"),
        custom_bitrate_mbps=immutable.get("custom_bitrate_mbps"),
        export_mode=immutable.get("export_mode", "full_video"),
        captions_only=immutable.get("export_mode") == "captions_only",
        background_color=immutable.get("background_color", "#101010"),
        duration_override=immutable.get("duration_override"),
        duration_source=immutable.get("duration_source"),
        visible_tracks_count=None,
        source_media_count=None,
        caption_chunks_count=None,
        hardware_acceleration=bool(immutable.get("hardware_acceleration", False)),
        render_mode=immutable.get("render_mode", "headless"),
        original_video_path=await _admin_source_media_path(db, source_row),
        composition_json=immutable.get("composition_json"),
    )
    async with export_runtime._jobs_lock:
        export_runtime._jobs[new_id] = retry
    asyncio.create_task(export_runtime._run_export_job(new_id, export_request))
    result = {"ok": True, "exportId": new_id, "correlationId": admin.correlation_id}
    await _remember_result(db, request, "export.retry", export_id, result)
    return result


@router.post("/exports/{export_id}/delete-output")
async def delete_export_output(
    export_id: str,
    body: ReasonRequest,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    admin = require_backend_admin_permission(request, "exports.delete_output")
    existing = await _existing_result(db, request, "export.delete_output", export_id)
    if existing is not None:
        return existing
    row = await (await db.execute("SELECT * FROM export_jobs WHERE id = ?", (export_id,))).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Export not found")
    output_path = Path(row["output_path"] or "")
    export_root = EXPORT_DIR.resolve()
    resolved = output_path.resolve() if output_path else export_root
    if resolved != export_root and export_root not in resolved.parents:
        raise HTTPException(status_code=400, detail="Invalid export path")
    if resolved.is_file():
        resolved.unlink()
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """
        UPDATE export_jobs SET status = 'expired', stage = 'output_deleted',
          deleted_at = ?, delete_reason = ?, output_path = NULL,
          download_url = NULL, updated_at = ? WHERE id = ?
        """,
        (now, "Deleted by administrator", now, export_id),
    )
    await db.commit()
    await mirror_export_job(export_id)
    result = {"ok": True, "status": "expired", "correlationId": admin.correlation_id}
    await _remember_result(db, request, "export.delete_output", export_id, result)
    return result


@router.post("/reconcile")
async def reconcile_operations(body: ReasonRequest, request: Request):
    admin = require_backend_admin_permission(request, "system.manage_providers")
    report = await reconcile_runtime_jobs()
    return {"ok": True, "report": report, "correlationId": admin.correlation_id}


@router.get("/transcription/catalog")
async def transcription_catalog(request: Request):
    admin = require_backend_admin_permission(request, "system.read")
    return {"items": public_catalog(), "correlationId": admin.correlation_id}


@router.post("/transcription/cache/invalidate")
async def transcription_cache_invalidate(body: ReasonRequest, request: Request):
    admin = require_backend_admin_permission(request, "system.manage_providers")
    invalidate_transcription_config_cache()
    return {"ok": True, "correlationId": admin.correlation_id}


@router.post("/transcription/test")
async def transcription_test_config(body: TranscriptionTestRequest, request: Request):
    admin = require_backend_admin_permission(request, "system.manage_providers")
    try:
        entry = validate_catalog_selection(
            body.provider,
            body.model,
            body.timestampStrategy,
            body.providerOptions,
        )
    except ValueError as exc:
        return {
            "ok": False,
            "category": str(exc),
            "retryable": False,
            "correlationId": admin.correlation_id,
        }
    availability = model_runtime_availability(entry)
    if not availability.get("productionReady"):
        return {
            "ok": False,
            "category": availability.get("reason") or "model_unavailable",
            "message": availability.get("message") or "Provider/model is unavailable.",
            "retryable": False,
            "correlationId": admin.correlation_id,
        }
    secret = os.getenv(entry.required_secret, "")
    if not is_real_secret(secret):
        return {
            "ok": False,
            "category": "authentication_failed",
            "retryable": False,
            "correlationId": admin.correlation_id,
        }
    snapshot = TranscriptionConfigSnapshot(
        configuration_id=body.configurationId,
        provider=entry.provider,
        model=entry.model,
        version=body.version,
        provider_options=dict(body.providerOptions or {}),
        timestamp_strategy=entry.timestamp_strategy,
        strict_provider=True,
        pipeline_options=resolve_pipeline_config(body.pipelineOptions or DEFAULT_PIPELINE_OPTIONS).to_dict(),
        resolved_pipeline_options=resolve_pipeline_config(body.pipelineOptions or DEFAULT_PIPELINE_OPTIONS).to_dict(),
    )
    started = time.monotonic()
    try:
        resolved_pipeline = resolve_pipeline_config(body.pipelineOptions or DEFAULT_PIPELINE_OPTIONS)
        stages: list[dict[str, object]] = []
        result = transcribe_audio(
            bundled_test_audio_path(),
            language_mode="english",
            transcription_config_snapshot=snapshot.to_dict(),
        )
        latency_ms = int((time.monotonic() - started) * 1000)
        word_count = len(result.get("words") or [])
        if not str(result.get("text") or "").strip():
            raise TranscriptionProviderError(entry.provider, "empty_transcript", "empty transcript")
        stages.append({"name": "Sarvam transcription" if entry.provider == "sarvam" else "Provider transcription", "status": "passed"})

        native_words_available = bool(result.get("nativeWordsAvailable", entry.timestamp_strategy == "provider_word"))
        timing_provenance = "provider_native" if native_words_available else None
        forced_word_count = 0
        if entry.timestamp_strategy != "local_forced_alignment":
            if native_words_available:
                stages.append({"name": "Native word timing", "status": "passed", "wordCount": word_count})
            else:
                stages.append({
                    "name": "Native word timing",
                    "status": "unavailable",
                    "category": result.get("nativeTimingFailureCategory") or "native_words_unavailable",
                })
                if resolved_pipeline.timingSourcePolicy == "native_required":
                    raise TranscriptionProviderError(
                        entry.provider,
                        result.get("nativeTimingFailureCategory") or "sarvam_native_timestamps_unavailable_after_retry",
                        result.get("nativeTimingFailureMessage") or "Provider did not return native word timestamps.",
                        request_id=result.get("provider_request_id") or result.get("request_id"),
                        retryable=False,
                    )
                if resolved_pipeline.timingSourcePolicy not in {"native_then_forced", "forced"}:
                    raise TranscriptionProviderError(entry.provider, "timestamps_missing", "missing native word timestamps")

                duration = float(result.get("duration") or 10.0)
                seed_segments = align_text(
                    [{"text": str(result.get("text") or ""), "start": 0.0, "end": duration}],
                    bundled_test_audio_path(),
                    MODEL_ALIGN_EN,
                    allow_fallback=resolved_pipeline.alignment.stableTsEnabled,
                    enable_whisperx=resolved_pipeline.alignment.whisperxEnabled,
                    provider=resolved_pipeline.alignment.provider,
                )
                stable_result = apply_stable_refinement(
                    seed_segments,
                    bundled_test_audio_path(),
                    "english",
                    config={
                        "enabled": resolved_pipeline.alignment.stableTsEnabled,
                        "model": resolved_pipeline.alignment.stableTsModel,
                        "device": resolved_pipeline.alignment.stableTsDevice,
                        "minMatchCoverage": resolved_pipeline.alignment.stableTsMinMatchCoverage,
                        "minWordRatio": resolved_pipeline.alignment.stableTsMinWordRatio,
                        "maxWordRatio": resolved_pipeline.alignment.stableTsMaxWordRatio,
                        "allowOrderFallback": resolved_pipeline.alignment.allowStableTsOrderFallback,
                    },
                )
                forced_word_count = int(stable_result.report.get("appliedWords") or 0)
                if not stable_result.report.get("applied"):
                    raise TranscriptionProviderError(
                        "stable_ts",
                        str(stable_result.report.get("errorCategory") or "stable_ts_alignment_failed"),
                        str(stable_result.report.get("reason") or "stable-ts alignment failed"),
                        retryable=False,
                    )
                stages.append({"name": "Forced alignment", "status": "passed", "wordCount": forced_word_count})
                timing_provenance = "realigned"
        elif word_count < 1:
            stages.append({"name": "Forced alignment", "status": "required"})
        return {
            "ok": True,
            "category": None,
            "latencyMs": latency_ms,
            "wordCount": forced_word_count or word_count,
            "nativeWordCount": result.get("nativeWordCount") or (word_count if native_words_available else 0),
            "phraseEntryCount": result.get("phraseEntryCount") or 0,
            "timingGranularity": result.get("timing_granularity"),
            "timingProvenance": timing_provenance,
            "stages": stages + [{"name": "Final result", "status": "passed"}],
            "resolvedPipelineOptions": snapshot.resolved_pipeline_options,
            "providerRequestId": result.get("provider_request_id") or result.get("request_id"),
            "circuit": circuit_state(snapshot),
            "correlationId": admin.correlation_id,
        }
    except TranscriptionProviderError as exc:
        return {
            "ok": False,
            "category": exc.category,
            "httpStatus": exc.status,
            "providerCode": exc.provider_code,
            "providerRequestId": exc.request_id,
            "retryable": exc.retryable,
            "correlationId": admin.correlation_id,
        }
    except Exception as exc:
        return {
            "ok": False,
            "category": "unknown_provider_error",
            "retryable": False,
            "correlationId": admin.correlation_id,
        }


@router.post("/projects/{project_id}/cleanup")
async def cleanup_admin_project(
    project_id: str,
    body: ReasonRequest,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    admin = require_backend_admin_permission(request, "projects.delete_temp_assets")
    existing = await _existing_result(db, request, "project.cleanup", project_id)
    if existing is not None:
        return existing
    row = await (await db.execute("SELECT * FROM jobs WHERE id = ? OR project_id = ? LIMIT 1", (project_id, project_id))).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    if row["status"] in ACTIVE_JOB_STATUSES:
        raise HTTPException(status_code=409, detail="Active caption work still requires these assets")
    active_export = await (await db.execute(
        "SELECT 1 FROM export_jobs WHERE (source_job_id = ? OR project_id = ?) AND status IN ('queued','running') LIMIT 1",
        (row["id"], project_id),
    )).fetchone()
    if active_export:
        raise HTTPException(status_code=409, detail="Active export work still requires these assets")
    retention_hold, _ = await project_retention_state(project_id)
    if retention_hold:
        raise HTTPException(status_code=409, detail="Remove the retention hold before cleanup")
    owned_project_id = row["project_id"] or row["id"]
    deletion = await delete_project_resources(owned_project_id, row["user_id"])
    result = {
        "ok": True,
        "removedFiles": deletion["removed"],
        "correlationId": admin.correlation_id,
    }
    await _remember_result(db, request, "project.cleanup", project_id, result)
    return result


@internal_router.post("/users/{user_id}/execute-deletion")
async def execute_due_user_deletion(
    user_id: str,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    expected = os.getenv("INTERNAL_MAINTENANCE_SECRET", "")
    supplied = request.headers.get("x-capinsta-maintenance-secret", "")
    if len(expected) < 32 or not secrets.compare_digest(expected, supplied):
        raise HTTPException(status_code=401, detail="Unauthorized")
    cursor = await db.execute(
        "SELECT id, project_id, status FROM jobs WHERE user_id = ?", (user_id,)
    )
    rows = await cursor.fetchall()
    removed = 0
    project_ids: set[str] = set()
    for row in rows:
        project_ids.add(str(row["project_id"] or row["id"]))
    for project_id in project_ids:
        deletion = await delete_project_resources(project_id, user_id)
        removed += int(deletion["removed"])
    return {"ok": True, "projects": len(project_ids), "removedFiles": removed}
