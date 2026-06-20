import asyncio
import json
import logging
import math
import os
import re
import time
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import aiosqlite
from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from ..database import get_db
from ..headless_export import ExportStageError, export_headless
from ..progress import manager
from ..project_cleanup import EXPIRED_MESSAGE, ensure_project_available, is_deleted_row
from ..settings import (
    EXPORT_DIR,
    DB_PATH,
    MAX_CONCURRENT_EXPORTS,
    MAX_EXPORT_DURATION_SECONDS,
    UPLOAD_DIR,
    ensure_runtime_dirs,
)
from .jobs import _public_export_stage, _resolve_export_dimensions


router = APIRouter(prefix="/export/jobs", tags=["export"])
logger = logging.getLogger(__name__)

ensure_runtime_dirs()

ExportStatus = Literal["queued", "running", "completed", "failed", "expired"]
_export_semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXPORTS)
_jobs_lock = asyncio.Lock()
_jobs: dict[str, "ExportJobStatus"] = {}
_EXPORT_JOB_COLUMNS = (
    "id",
    "source_job_id",
    "status",
    "stage",
    "progress",
    "message",
    "error",
    "download_url",
    "filename",
    "output_path",
    "bytes",
    "duration",
    "width",
    "height",
    "fps",
    "created_at",
    "updated_at",
    "expires_at",
    "deleted_at",
    "delete_reason",
)


@dataclass
class ExportRequest:
    source_job_id: str
    captions_json: str
    theme: str
    style_config_json: str | None
    resolution: str
    export_width: int | None
    export_height: int | None
    export_fps: int
    include_audio: bool
    quality: str
    bitrate: str
    custom_bitrate_mbps: float | None
    export_mode: str
    captions_only: bool
    background_color: str
    duration_override: float | None
    duration_source: str | None
    visible_tracks_count: int | None
    source_media_count: int | None
    caption_chunks_count: int | None
    hardware_acceleration: bool
    render_mode: str
    original_video_path: str
    composition_json: str | None


@dataclass
class ExportJobStatus:
    id: str
    source_job_id: str
    status: ExportStatus
    stage: str
    progress: int
    message: str = ""
    error: str | None = None
    download_url: str | None = None
    filename: str | None = None
    output_path: str | None = None
    bytes: int | None = None
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    fps: int | None = None
    performance: dict[str, object] | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    expires_at: str | None = None
    deleted_at: str | None = None
    delete_reason: str | None = None

    def to_public_dict(self) -> dict[str, object]:
        return {
            "jobId": self.id,
            "sourceJobId": self.source_job_id,
            "status": self.status,
            "stage": self.stage,
            "progress": self.progress,
            "message": self.message,
            "error": self.error,
            "downloadUrl": self.download_url,
            "filename": self.filename,
            "bytes": self.bytes,
            "duration": self.duration,
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "performance": self.performance,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_db_values(job: ExportJobStatus) -> tuple[object, ...]:
    return (
        job.id,
        job.source_job_id,
        job.status,
        job.stage,
        job.progress,
        job.message,
        job.error,
        job.download_url,
        job.filename,
        job.output_path,
        job.bytes,
        job.duration,
        job.width,
        job.height,
        job.fps,
        job.created_at,
        job.updated_at,
        job.expires_at,
        job.deleted_at,
        job.delete_reason,
    )


def _job_from_row(row: aiosqlite.Row) -> ExportJobStatus:
    return ExportJobStatus(
        id=row["id"],
        source_job_id=row["source_job_id"],
        status=row["status"],
        stage=row["stage"],
        progress=int(row["progress"] or 0),
        message=row["message"] or "",
        error=row["error"],
        download_url=row["download_url"],
        filename=row["filename"],
        output_path=row["output_path"],
        bytes=row["bytes"],
        duration=row["duration"],
        width=row["width"],
        height=row["height"],
        fps=row["fps"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        expires_at=row["expires_at"],
        deleted_at=row["deleted_at"],
        delete_reason=row["delete_reason"],
    )


async def _persist_job(job: ExportJobStatus) -> None:
    placeholders = ", ".join("?" for _ in _EXPORT_JOB_COLUMNS)
    update_columns = [column for column in _EXPORT_JOB_COLUMNS if column != "id"]
    update_clause = ", ".join(f"{column}=excluded.{column}" for column in update_columns)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            f"""
            INSERT INTO export_jobs ({", ".join(_EXPORT_JOB_COLUMNS)})
            VALUES ({placeholders})
            ON CONFLICT(id) DO UPDATE SET {update_clause}
            """,
            _job_db_values(job),
        )
        await db.commit()


async def _load_job_from_db(export_job_id: str) -> ExportJobStatus | None:
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM export_jobs WHERE id = ?", (export_job_id,))
        row = await cursor.fetchone()
    return _job_from_row(row) if row else None


async def _load_recent_jobs_from_db(limit: int = 50) -> list[ExportJobStatus]:
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM export_jobs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
        rows = await cursor.fetchall()
    return [_job_from_row(row) for row in rows]


async def recover_orphaned_export_jobs() -> int:
    """Mark queued/running exports as failed after a process restart."""
    now = _utc_now()
    message = "Export worker restarted before this MP4 finished. Please start the export again."
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            """
            UPDATE export_jobs
            SET status = 'failed',
                stage = 'worker_restart',
                progress = -1,
                message = ?,
                error = ?,
                updated_at = ?
            WHERE status IN ('queued', 'running')
            """,
            (message, message, now),
        )
        await db.commit()
        return cursor.rowcount or 0


def _export_download_url(filename: str) -> str:
    return f"/api/export/jobs/download/{filename}"


def _resolve_export_file(filename: str) -> Path:
    safe_name = Path(filename).name
    if safe_name != filename or not safe_name.lower().endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Invalid export filename.")

    export_root = EXPORT_DIR.resolve()
    file_path = (export_root / safe_name).resolve()
    if export_root not in file_path.parents and file_path != export_root:
        raise HTTPException(status_code=400, detail="Invalid export path.")
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Export file was not found or has expired.")
    return file_path


def _dimensions_from_export_filename(filename: str, fallback_width: int, fallback_height: int) -> tuple[int, int]:
    match = re.search(r"_(\d+)x(\d+)\.mp4$", filename)
    if not match:
        return fallback_width, fallback_height
    return int(match.group(1)), int(match.group(2))


def _memory_mb() -> float | None:
    try:
        import resource

        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return usage / 1024 if os.name != "nt" else usage / (1024 * 1024)
    except Exception:
        return None


def _stage_from_progress(status: str, details: str) -> str:
    combined = f"{status} {details}".lower()
    if "launch" in combined:
        return "renderer_launch"
    if "load" in combined or "composition" in combined:
        return "prepare_render_input"
    if "frame" in combined or "capture" in combined or status == "exporting":
        return "frame_capture"
    if "complete" in combined:
        return "completed"
    if "fail" in combined:
        return "failed"
    return status or "running"


async def _prune_jobs() -> None:
    cutoff = time.time() - 24 * 3600
    cutoff_iso = datetime.fromtimestamp(cutoff, timezone.utc).isoformat()
    async with _jobs_lock:
        old_ids = []
        for job_id, job in _jobs.items():
            try:
                updated = datetime.fromisoformat(job.updated_at).timestamp()
            except ValueError:
                updated = time.time()
            if job.status in {"completed", "failed"} and updated < cutoff:
                old_ids.append(job_id)
        for job_id in old_ids:
            _jobs.pop(job_id, None)
        if len(_jobs) > 150:
            removable = sorted(
                (job for job in _jobs.values() if job.status in {"completed", "failed"}),
                key=lambda item: item.updated_at,
            )
            for job in removable[: max(0, len(_jobs) - 150)]:
                _jobs.pop(job.id, None)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """
            DELETE FROM export_jobs
            WHERE status IN ('completed', 'failed') AND updated_at < ?
            """,
            (cutoff_iso,),
        )
        await db.commit()


async def _set_job(job_id: str, **updates: object) -> ExportJobStatus:
    async with _jobs_lock:
        job = _jobs[job_id]
        for key, value in updates.items():
            setattr(job, key, value)
        job.updated_at = _utc_now()
        snapshot = replace(job)
    await _persist_job(snapshot)
    return snapshot


async def _broadcast_progress(job: ExportJobStatus) -> None:
    payload = {
        "status": f"export_{job.status}",
        "percent": job.progress,
        "details": job.message or job.stage,
        "stage": job.stage,
        "exportJobId": job.id,
    }
    await manager.broadcast(job.id, payload)
    if job.source_job_id:
        await manager.broadcast(job.source_job_id, payload)


def _validate_duration(duration: float | None) -> None:
    if duration is None or duration <= 0:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "stage": "determine_duration",
                "error": "Export duration is required. Use captions, timeline, sequence, or a custom duration.",
            },
        )
    if duration > MAX_EXPORT_DURATION_SECONDS:
        raise HTTPException(
            status_code=413,
            detail={
                "success": False,
                "stage": "validate_request",
                "error": (
                    f"Export duration {duration:.2f}s exceeds MAX_EXPORT_DURATION_SECONDS="
                    f"{MAX_EXPORT_DURATION_SECONDS}. Reduce duration/resolution or raise the env limit."
                ),
            },
        )


async def _run_export_job(export_job_id: str, request: ExportRequest) -> None:
    queue_started = time.perf_counter()
    queued_job = await _set_job(
        export_job_id,
        status="queued",
        stage="queued",
        progress=0,
        message="Waiting for an available export worker...",
    )
    await _broadcast_progress(queued_job)

    async with _export_semaphore:
        queue_wait_seconds = time.perf_counter() - queue_started
        started_memory = _memory_mb()
        logger.info(
            "export_job_started export_job_id=%s source_job_id=%s mode=%s render_mode=%s duration=%s fps=%s size=%sx%s memory_mb=%s",
            export_job_id,
            request.source_job_id,
            request.export_mode,
            request.render_mode,
            request.duration_override,
            request.export_fps,
            request.export_width,
            request.export_height,
            started_memory,
        )
        running_job = await _set_job(
            export_job_id,
            status="running",
            stage="prepare_render_input",
            progress=1,
            message="Preparing render input...",
        )
        await _broadcast_progress(running_job)

        async def progress_cb(status: str, percent: int, details: str):
            stage = _stage_from_progress(status, details)
            progress = max(0, min(99, int(percent)))
            job = await _set_job(
                export_job_id,
                status="running",
                stage=stage,
                progress=progress,
                message=details or stage,
            )
            await _broadcast_progress(job)

        async def performance_cb(summary: dict[str, object]) -> None:
            await _set_job(export_job_id, performance=summary)

        try:
            if request.render_mode != "headless":
                raise ExportStageError("validate_request", "Background export jobs currently support headless MP4 export only.")
            if not request.captions_json or not request.captions_json.strip():
                raise ExportStageError("render_input", "No captions JSON was provided for MP4 export.")

            try:
                parsed_captions = json.loads(request.captions_json)
            except json.JSONDecodeError as exc:
                raise ExportStageError("render_input", "Invalid captions JSON sent to export.", exc) from exc
            if not isinstance(parsed_captions, list):
                raise ExportStageError("render_input", "Captions JSON must be a list of caption chunks.")

            duration = float(request.duration_override or 0)
            total_frames = math.ceil(duration * request.export_fps) if duration > 0 else None
            logger.info(
                "export_job_request export_job_id=%s export_mode=%s captions_only=%s width=%s height=%s fps=%s duration=%s include_audio=%s background_color=%s render_url=%s total_frames=%s",
                export_job_id,
                request.export_mode,
                request.export_mode in {"captions_only", "captions_only_solid_background", "captions_solid_background"}
                or request.captions_only,
                request.export_width,
                request.export_height,
                request.export_fps,
                request.duration_override,
                request.include_audio,
                request.background_color,
                os.getenv("RENDER_PAGE_URL") or "bundled/static render page",
                total_frames,
            )

            output_path = await export_headless(
                job_id=export_job_id,
                source_job_id=request.source_job_id,
                video_path=request.original_video_path,
                captions_json=request.captions_json,
                theme=request.theme,
                resolution=request.resolution,
                progress_callback=progress_cb,
                style_config_json=request.style_config_json,
                export_width=request.export_width,
                export_height=request.export_height,
                export_fps=request.export_fps,
                include_audio=request.include_audio,
                quality=request.quality,
                bitrate=request.bitrate,
                custom_bitrate_mbps=request.custom_bitrate_mbps,
                export_mode=request.export_mode,
                background_color=request.background_color,
                duration_override=request.duration_override,
                duration_source=request.duration_source,
                hardware_acceleration=request.hardware_acceleration,
                composition_json=request.composition_json,
                queue_wait_seconds=queue_wait_seconds,
                performance_callback=performance_cb,
            )

            output = Path(output_path)
            output_bytes = output.stat().st_size if output.exists() else 0
            if output_bytes <= 0:
                raise ExportStageError("output_write", f"FFmpeg finished but output file is missing or empty: {output_path}")

            fallback_width, fallback_height = _resolve_export_dimensions(
                request.resolution,
                request.export_width,
                request.export_height,
            )
            width, height = _dimensions_from_export_filename(output.name, fallback_width, fallback_height)
            download_url = _export_download_url(output.name)
            completed = await _set_job(
                export_job_id,
                status="completed",
                stage="completed",
                progress=100,
                message="MP4 export is ready to download.",
                error=None,
                download_url=download_url,
                filename=output.name,
                output_path=str(output),
                bytes=output_bytes,
                duration=float(request.duration_override or 0),
                width=width,
                height=height,
                fps=request.export_fps,
            )
            logger.info(
                "export_job_completed export_job_id=%s source_job_id=%s output=%s bytes=%s memory_mb=%s",
                export_job_id,
                request.source_job_id,
                output,
                output_bytes,
                _memory_mb(),
            )
            await _broadcast_progress(completed)
        except ExportStageError as exc:
            public_stage = _public_export_stage(exc.stage)
            message = str(exc)
            failed = await _set_job(
                export_job_id,
                status="failed",
                stage=public_stage,
                progress=-1,
                message=f"Export failed during {public_stage}: {message}",
                error=message,
            )
            logger.exception(
                "export_job_failed export_job_id=%s source_job_id=%s stage=%s error=%s memory_mb=%s",
                export_job_id,
                request.source_job_id,
                exc.stage,
                message,
                _memory_mb(),
            )
            await _broadcast_progress(failed)
        except Exception as exc:
            message = str(exc).strip() or repr(exc) or type(exc).__name__
            failed = await _set_job(
                export_job_id,
                status="failed",
                stage="render_video",
                progress=-1,
                message=f"Export failed during render_video: {type(exc).__name__}: {message}",
                error=f"{type(exc).__name__}: {message}",
            )
            logger.exception(
                "export_job_failed_unexpected export_job_id=%s source_job_id=%s error=%s memory_mb=%s",
                export_job_id,
                request.source_job_id,
                message,
                _memory_mb(),
            )
            await _broadcast_progress(failed)


def export_job_metrics() -> dict[str, int]:
    values = list(_jobs.values())
    return {
        "maxConcurrentExports": MAX_CONCURRENT_EXPORTS,
        "maxExportDurationSeconds": MAX_EXPORT_DURATION_SECONDS,
        "activeExports": sum(1 for job in values if job.status == "running"),
        "queuedExports": sum(1 for job in values if job.status == "queued"),
        "trackedExportJobs": len(values),
    }


@router.post("")
@router.post("/")
async def start_export_job(
    db: aiosqlite.Connection = Depends(get_db),
    source_job_id: str = Form(...),
    captions_json: str = Form("[]"),
    theme: str = Form("word_highlight_box"),
    style_config_json: str | None = Form(None),
    resolution: str = Form("1080p"),
    export_width: int | None = Form(None),
    export_height: int | None = Form(None),
    export_fps: int = Form(30),
    include_audio: bool = Form(True),
    quality: str = Form("standard"),
    bitrate: str = Form("auto"),
    custom_bitrate_mbps: float | None = Form(None),
    export_mode: str = Form("full_video"),
    captions_only: bool = Form(False),
    background_color: str = Form("#101010"),
    duration_override: float | None = Form(None),
    duration_source: str | None = Form(None),
    duration_mode: str | None = Form(None),
    custom_duration: float | None = Form(None),
    visible_tracks_count: int | None = Form(None),
    source_media_count: int | None = Form(None),
    caption_chunks_count: int | None = Form(None),
    hardware_acceleration: bool = Form(False),
    render_mode: str = Form("headless"),
    composition_json: str | None = Form(None),
):
    await _prune_jobs()
    if duration_override is None and custom_duration is not None:
        duration_override = custom_duration
    if duration_source is None and duration_mode is not None:
        duration_source = duration_mode
    _validate_duration(duration_override)

    export_fps = max(1, min(120, int(export_fps or 30)))
    export_mode = "captions_only" if captions_only else export_mode
    if export_mode not in {
        "full_video",
        "captions_only",
        "captions_only_solid_background",
        "captions_solid_background",
    }:
        return JSONResponse(
            {"success": False, "stage": "validate_request", "error": f"Unsupported export mode: {export_mode}"},
            status_code=400,
        )

    cursor = await db.execute("SELECT * FROM jobs WHERE id = ?", (source_job_id,))
    row = await cursor.fetchone()
    if not row:
        return JSONResponse(
            {"success": False, "stage": "validate_project", "error": "Source caption job was not found."},
            status_code=404,
        )
    await ensure_project_available(row, db)

    original_video_path = str(UPLOAD_DIR / f"{source_job_id}_{row['filename']}")
    is_captions_only = export_mode in {
        "captions_only",
        "captions_only_solid_background",
        "captions_solid_background",
    }
    if not os.path.exists(original_video_path) and not is_captions_only:
        return JSONResponse(
            {
                "success": False,
                "stage": "resolve_media",
                "error": f"Source media file was not found for export: {original_video_path}",
            },
            status_code=404,
        )
    if not os.path.exists(original_video_path) and is_captions_only:
        include_audio = False

    request = ExportRequest(
        source_job_id=source_job_id,
        captions_json=captions_json,
        theme=theme,
        style_config_json=style_config_json,
        resolution=resolution,
        export_width=export_width,
        export_height=export_height,
        export_fps=export_fps,
        include_audio=include_audio,
        quality=quality,
        bitrate=bitrate,
        custom_bitrate_mbps=custom_bitrate_mbps,
        export_mode=export_mode,
        captions_only=captions_only,
        background_color=background_color,
        duration_override=duration_override,
        duration_source=duration_source,
        visible_tracks_count=visible_tracks_count,
        source_media_count=source_media_count,
        caption_chunks_count=caption_chunks_count,
        hardware_acceleration=hardware_acceleration,
        render_mode=render_mode,
        original_video_path=original_video_path,
        composition_json=composition_json,
    )

    export_job_id = str(uuid.uuid4())
    async with _jobs_lock:
        queued_job = ExportJobStatus(
            id=export_job_id,
            source_job_id=source_job_id,
            status="queued",
            stage="queued",
            progress=0,
            message="Export queued.",
            duration=float(duration_override or 0),
            width=export_width,
            height=export_height,
            fps=export_fps,
            expires_at=row["expires_at"],
        )
        _jobs[export_job_id] = queued_job
    await _persist_job(queued_job)

    logger.info(
        "export_job_queued export_job_id=%s source_job_id=%s mode=%s duration=%s fps=%s captions=%s output_dir=%s",
        export_job_id,
        source_job_id,
        export_mode,
        duration_override,
        export_fps,
        caption_chunks_count,
        EXPORT_DIR,
    )
    asyncio.create_task(_run_export_job(export_job_id, request))

    return {
        "success": True,
        "jobId": export_job_id,
        "statusUrl": f"/api/export/jobs/{export_job_id}",
        "message": "Export started",
    }


@router.get("")
@router.get("/")
async def list_export_jobs():
    jobs = await _load_recent_jobs_from_db(50)
    return [job.to_public_dict() for job in jobs]


@router.get("/download/{filename}")
async def download_export_file(
    filename: str, db: aiosqlite.Connection = Depends(get_db)
):
    cursor = await db.execute(
        """
        SELECT e.*, j.deleted_at AS source_deleted_at, j.status AS source_status
        FROM export_jobs e JOIN jobs j ON j.id = e.source_job_id
        WHERE e.filename = ? OR e.output_path LIKE ?
        ORDER BY e.created_at DESC LIMIT 1
        """,
        (Path(filename).name, f"%{Path(filename).name}"),
    )
    row = await cursor.fetchone()
    if row and (
        is_deleted_row(row)
        or row["source_deleted_at"]
        or row["source_status"] == "expired"
    ):
        raise HTTPException(status_code=410, detail=EXPIRED_MESSAGE)
    source_cursor = await db.execute(
        """
        SELECT * FROM jobs
        WHERE substr(?, 1, length(id) + 1) = id || '_'
        ORDER BY length(id) DESC LIMIT 1
        """,
        (Path(filename).name,),
    )
    source_row = await source_cursor.fetchone()
    if source_row:
        await ensure_project_available(source_row, db)
    file_path = _resolve_export_file(filename)
    return FileResponse(
        file_path,
        media_type="video/mp4",
        filename=file_path.name,
        headers={
            "Content-Disposition": f'attachment; filename="{file_path.name}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=86400",
        },
    )


@router.get("/{export_job_id}")
async def get_export_job(
    export_job_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    cursor = await db.execute("SELECT * FROM export_jobs WHERE id = ?", (export_job_id,))
    persisted = await cursor.fetchone()
    if persisted and is_deleted_row(persisted):
        raise HTTPException(status_code=410, detail=EXPIRED_MESSAGE)
    async with _jobs_lock:
        job = _jobs.get(export_job_id)
        if job:
            return job.to_public_dict()

    job = await _load_job_from_db(export_job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    if job.status in {"queued", "running"}:
        message = "Export worker restarted before this MP4 finished. Please start the export again."
        job.status = "failed"
        job.stage = "worker_restart"
        job.progress = -1
        job.message = message
        job.error = message
        job.updated_at = _utc_now()
        await _persist_job(job)

    return job.to_public_dict()
