import os
import json
import uuid
import logging
import re
import asyncio
from datetime import datetime, timezone
from typing import Any, List
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
import aiosqlite
import aiofiles

from ..database import get_db, DB_PATH
from ..models import JobResponse, JobDetailResponse
from ..progress import manager
from ..settings import EXPORT_DIR, MAX_UPLOAD_SIZE_MB, UPLOAD_DIR, ensure_runtime_dirs
from ..project_cleanup import ensure_project_available, heartbeat_project, iso_utc, project_expiry
from ..worker_startup import start_pipeline_worker
from ..auth import current_user, get_owned_job, verify_access_token
from ..operational_mirror import mirror_caption_job
from ..runtime_policy import enforce_caption_quota, require_feature, require_provider_enabled
from ai_pipeline.renderer import generate_srt, generate_vtt
from ai_pipeline.sync.aligned_words import aligned_word_quality, canonical_aligned_words_from_segments
from ai_pipeline.sync.affine import retime_segments
from ai_pipeline.sync.auto_sync import apply_auto_sync_if_confident
from ai_pipeline.sync.high_quality import high_quality_alignment_status, run_high_quality_alignment
from ai_pipeline.language_modes import SUPPORTED_LANGUAGE_MODES, normalize_language_mode
from ai_pipeline.timing import DEFAULT_PAUSE_SPLIT_THRESHOLD, build_timing_report, classify_caption_gaps, normalize_timing_source

router = APIRouter(prefix="/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)

ensure_runtime_dirs()

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v"}
ALLOWED_CONTENT_TYPES = {"video/mp4", "video/quicktime", "application/octet-stream"}
INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
WINDOWS_RESERVED_FILENAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}
# Keep a conservative length so the full path stays safe on Windows.
MAX_SAFE_FILENAME_LEN = 120


class SyncRequest(BaseModel):
    shiftSeconds: float = 0.0
    skew: float = 1.0
    anchorSeconds: float = 0.0
    startRange: float | None = None
    endRange: float | None = None


def _log_stage(job_id: str | None, stage: str, **fields):
    details = " ".join(f"{key}={value!r}" for key, value in fields.items())
    logger.info("job_stage job_id=%s stage=%s %s", job_id or "-", stage, details)


def _sanitize_upload_filename(filename: str, ext: str) -> str:
    stem = Path(filename).stem
    stem = INVALID_FILENAME_CHARS.sub("_", stem)
    stem = re.sub(r"\s+", " ", stem).strip(" ._")

    if not stem:
        stem = "upload"

    if stem.upper() in WINDOWS_RESERVED_FILENAMES:
        stem = f"{stem}_file"

    max_stem_len = max(1, MAX_SAFE_FILENAME_LEN - len(ext))
    stem = stem[:max_stem_len].rstrip(" ._") or "upload"
    return f"{stem}{ext}"


def _validate_upload_metadata(file: UploadFile) -> str:
    filename = os.path.basename(file.filename or "")
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Upload MP4 or MOV ({allowed}).")

    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported media type '{file.content_type}'. Upload an MP4 or MOV video.",
        )

    return _sanitize_upload_filename(filename, ext)


async def _media_duration_seconds(file_path: str) -> float:
    try:
        process = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            file_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=15)
        if process.returncode == 0:
            return max(0.0, float(stdout.decode().strip()))
    except (FileNotFoundError, ValueError, asyncio.TimeoutError):
        logger.warning("media_duration_probe_failed path=%s", file_path)
    return 0.0


def _stored_language_mode(value: str | None) -> str:
    try:
        return normalize_language_mode(value)
    except ValueError:
        return "auto_mixed_indian"


def _load_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return fallback


def _video_path_for_row(job_id: str, row: aiosqlite.Row) -> str:
    return str(UPLOAD_DIR / f"{job_id}_{row['filename']}")


def _flatten_word_debug(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for seg_index, segment in enumerate(segments):
        for word in segment.get("words") or []:
            words.append({
                "text": word.get("displayedWord") or word.get("word") or word.get("originalWord"),
                "displayWord": word.get("displayedWord") or word.get("word"),
                "spokenWord": word.get("spokenWord") or word.get("originalWord") or word.get("word"),
                "start": word.get("start"),
                "end": word.get("end"),
                "timingSource": normalize_timing_source(word.get("timingSource") or word.get("timing_source"), word.get("provider")),
                "timingSourceDetail": word.get("timingSourceDetail") or word.get("timingSource") or word.get("timing_source"),
                "chunkIndex": seg_index,
                "captionBlockId": segment.get("id"),
                "timestampBasis": word.get("timestampBasis") or word.get("provider") or "stored",
                "timingNeedsReview": bool(word.get("timingNeedsReview") or word.get("timingReviewRequired")),
            })
    return words


def _words_around_time(words: list[dict[str, Any]], current_time: float | None, limit: int = 100) -> list[dict[str, Any]]:
    if current_time is None or not words:
        return words[:limit]
    best_index = 0
    best_distance = float("inf")
    for index, word in enumerate(words):
        try:
            start = float(word.get("start") or 0.0)
            end = float(word.get("end") or start)
        except (TypeError, ValueError):
            continue
        distance = 0.0 if start <= current_time <= end else min(abs(current_time - start), abs(current_time - end))
        if distance < best_distance:
            best_distance = distance
            best_index = index
    half = max(1, limit // 2)
    start_index = max(0, min(best_index - half, max(0, len(words) - limit)))
    return words[start_index:start_index + limit]


def _sync_metadata(transcript: dict[str, Any] | None) -> dict[str, Any]:
    metadata = transcript.get("metadata") if isinstance(transcript, dict) else {}
    sync = metadata.get("sync") if isinstance(metadata, dict) else {}
    return sync if isinstance(sync, dict) else {}


def _update_transcript_segments(
    transcript: dict[str, Any] | None,
    segments: list[dict[str, Any]],
    sync_report: dict[str, Any] | None = None,
    timing_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    next_transcript = dict(transcript or {})
    next_transcript["segments"] = segments
    next_transcript["alignedWords"] = canonical_aligned_words_from_segments(segments)
    metadata = dict(next_transcript.get("metadata") or {})
    if sync_report is not None:
        metadata["sync"] = sync_report
    if timing_report is not None:
        timing = dict(metadata.get("timing") or {})
        timing["report"] = timing_report
        metadata["timing"] = timing
    next_transcript["metadata"] = metadata
    return next_transcript


async def _persist_synced_segments(
    db: aiosqlite.Connection,
    job_id: str,
    row: aiosqlite.Row,
    segments: list[dict[str, Any]],
    sync_report: dict[str, Any],
) -> dict[str, Any]:
    video_path = _video_path_for_row(job_id, row)
    audio_for_render = video_path if os.path.exists(video_path) else None
    srt = generate_srt(segments, audio_path=audio_for_render)
    vtt = generate_vtt(segments, audio_path=audio_for_render)
    transcript = _load_json(row["transcript_json"] if "transcript_json" in row.keys() else None, None)
    timing_report = build_timing_report(segments, [], sync_report)
    transcript = _update_transcript_segments(transcript, segments, sync_report, timing_report)
    await db.execute(
        """
        UPDATE jobs
        SET segments_json = ?, transcript_json = ?, srt_content = ?, vtt_content = ?
        WHERE id = ? AND user_id = ?
        """,
        (
            json.dumps(segments, ensure_ascii=False),
            json.dumps(transcript, ensure_ascii=False),
            srt,
            vtt,
            job_id,
            current_user().id,
        ),
    )
    await db.commit()
    return {"segments": segments, "transcript": transcript, "srt": srt, "vtt": vtt, "timingReport": timing_report}


def _public_export_stage(stage: str) -> str:
    return {
        "runtime_check": "validate_request",
        "headless_launch": "render_video",
        "render_input": "prepare_render_input",
        "media_resolution": "resolve_media",
        "duration_detection": "determine_duration",
        "composition_load": "prepare_render_input",
        "render_frames": "render_video",
        "ffmpeg_encode": "render_video",
        "output_write": "write_output",
        "failed": "render_video",
    }.get(stage, stage)


def _export_download_url(filename: str) -> str:
    return f"/api/export/jobs/download/{filename}"


def _dimensions_from_export_filename(filename: str, fallback_width: int, fallback_height: int) -> tuple[int, int]:
    match = re.search(r"_(\d+)x(\d+)\.mp4$", filename)
    if not match:
        return fallback_width, fallback_height
    return int(match.group(1)), int(match.group(2))


def _export_failure(stage: str, error: str, response_format: str, status_code: int = 500):
    public_stage = _public_export_stage(stage)
    payload = {
        "success": False,
        "stage": public_stage,
        "error": error,
    }
    if response_format == "json":
        return JSONResponse(payload, status_code=status_code)
    raise HTTPException(status_code=status_code, detail=f"Export failed during {public_stage}: {error}")


def _resolve_export_dimensions(resolution: str, export_width: int | None, export_height: int | None) -> tuple[int, int]:
    if export_width and export_height and export_width > 0 and export_height > 0:
        return int(export_width), int(export_height)
    if resolution == "720p":
        return 1280, 720
    if resolution == "480p":
        return 854, 480
    return 1920, 1080

@router.post("", response_model=JobResponse)
@router.post("/", response_model=JobResponse)
async def create_job(
    request: Request,
    languageMode: str = Form(None),
    target_lang: str = Form(None),
    project_id: str | None = Form(None),
    file: UploadFile = File(...)
):
    """Uploads a video and starts a background captioning job."""
    await require_feature("caption_generation_enabled", "Caption generation is temporarily unavailable.")
    await require_provider_enabled(os.getenv("STT_PROVIDER", "auto").strip().lower())
    await enforce_caption_quota(current_user().id)
    job_id = str(uuid.uuid4())
    requested_mode = languageMode or target_lang or "auto_mixed_indian"
    _log_stage(job_id, "request received", language_mode=requested_mode, upload_filename=file.filename)

    try:
        normalized_mode = normalize_language_mode(requested_mode)
    except ValueError as exc:
        _log_stage(job_id, "request rejected", reason=str(exc))
        raise HTTPException(
            status_code=400,
            detail=f"{exc} Supported modes: {', '.join(SUPPORTED_LANGUAGE_MODES)}.",
        )

    filename = _validate_upload_metadata(file)
    _log_stage(
        job_id,
        "selected media found",
        filename=filename,
        content_type=file.content_type,
        language_mode=normalized_mode,
    )

    try:
        from ai_pipeline.transcriber import validate_transcription_config

        validate_transcription_config(normalized_mode)
    except RuntimeError as exc:
        _log_stage(job_id, "request rejected", reason=str(exc), language_mode=normalized_mode)
        raise HTTPException(status_code=400, detail=str(exc))
    
    # Save file to disk
    file_path = str(UPLOAD_DIR / f"{job_id}_{filename}")
    _log_stage(job_id, "file path resolved", file_path=file_path)
    max_bytes = MAX_UPLOAD_SIZE_MB * 1024 * 1024
    bytes_written = 0
    try:
        async with aiofiles.open(file_path, 'wb') as out_file:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File is too large. Maximum upload size is {MAX_UPLOAD_SIZE_MB} MB.",
                    )
                await out_file.write(chunk)
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")
    finally:
        await file.close()

    _log_stage(job_id, "file saved", file_path=file_path, bytes=bytes_written)
    media_duration = await _media_duration_seconds(file_path)
    try:
        await enforce_caption_quota(
            current_user().id,
            media_duration if media_duration > 0 else None,
        )
    except HTTPException:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise

    # Insert initial job state
    async with aiosqlite.connect(str(DB_PATH)) as db:
        now = datetime.now(timezone.utc)
        now_text = iso_utc(now)
        expires_text = iso_utc(project_expiry(now, now_text))
        await db.execute(
            """
            INSERT INTO jobs
                (id, status, filename, target_lang, created_at, last_seen_at, expires_at,
                 user_id, project_id, correlation_id, media_duration_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id, "queued", filename, normalized_mode, now_text, now_text,
                expires_text, current_user().id, project_id or job_id,
                request.headers.get("x-correlation-id") or str(uuid.uuid4()),
                media_duration or None,
            ),
        )
        await db.commit()
    await mirror_caption_job(job_id)

    # Start background thread for heavy processing. The startup wrapper records
    # import/dependency failures as failed jobs instead of leaving them queued.
    start_pipeline_worker(
        job_id=job_id,
        file_path=file_path,
        language_mode=normalized_mode,
    )

    _log_stage(job_id, "response returned", status="queued", bytes=bytes_written)

    return JobResponse(
        job_id=job_id,
        status="queued",
        progress=0,
        filename=filename,
        target_lang=normalized_mode,
        languageMode=normalized_mode,
        video_url=f"/api/jobs/{job_id}/video",
    )

@router.get("", response_model=List[JobDetailResponse])
@router.get("/", response_model=List[JobDetailResponse])
async def list_jobs(db: aiosqlite.Connection = Depends(get_db)):
    """List all recent jobs."""
    cursor = await db.execute(
        "SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
        (current_user().id,),
    )
    rows = await cursor.fetchall()
    
    jobs = []
    for r in rows:
        jobs.append(JobDetailResponse(
            job_id=r['id'],
            status=r['status'],
            progress=r['progress'],
            filename=r['filename'],
            target_lang=r['target_lang'],
            languageMode=_stored_language_mode(r['target_lang']),
            error=r['error'],
            created_at=r['created_at'],
            completed_at=r['completed_at']
        ))
    return jobs

@router.get("/{job_id}", response_model=JobDetailResponse)
async def get_job(job_id: str, db: aiosqlite.Connection = Depends(get_db)):
    """Get detailed state of a specific job, including output blocks."""
    r = await get_owned_job(db, job_id)
    await ensure_project_available(r, db)
        
    # Parse segments from JSON
    segments = None
    if r['segments_json']:
        try:
            segments = json.loads(r['segments_json'])
        except (json.JSONDecodeError, TypeError):
            segments = None
    transcript = None
    if "transcript_json" in r.keys() and r["transcript_json"]:
        try:
            transcript = json.loads(r["transcript_json"])
        except (json.JSONDecodeError, TypeError):
            transcript = None

    return JobDetailResponse(
        job_id=r['id'],
        status=r['status'],
        progress=r['progress'],
        filename=r['filename'],
        target_lang=r['target_lang'],
        languageMode=_stored_language_mode(r['target_lang']),
        error=r['error'],
        vtt=r['vtt_content'],
        srt=r['srt_content'],
        segments=segments,
        transcript=transcript or {
            "languageMode": _stored_language_mode(r['target_lang']),
            "provider": "unknown",
            "romanized": False,
            "segments": segments or [],
        },
        output_video_url=f"/api/jobs/{job_id}/export" if r['status'] == "completed" else None,
        created_at=r['created_at'],
        completed_at=r['completed_at']
    )


@router.post("/{job_id}/heartbeat")
async def heartbeat_job(job_id: str, db: aiosqlite.Connection = Depends(get_db)):
    """Refresh the backend-enforced inactivity lease for an open editor."""
    await get_owned_job(db, job_id)
    result = await heartbeat_project(job_id, db)
    await mirror_caption_job(job_id)
    return result


@router.post("/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(job_id: str, db: aiosqlite.Connection = Depends(get_db)):
    row = await get_owned_job(db, job_id)

    if row["status"] == "completed":
        raise HTTPException(status_code=409, detail="Completed jobs cannot be cancelled.")

    await db.execute(
        """
        UPDATE jobs
        SET status = 'cancelled',
            progress = -1,
            error = 'Cancelled by user',
            completed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
        """,
        (job_id, current_user().id),
    )
    await db.commit()
    await mirror_caption_job(job_id)
    await manager.broadcast_progress(job_id, "cancelled", -1, "Cancelled by user.")

    return JobResponse(
        job_id=job_id,
        status="cancelled",
        progress=-1,
        filename=row["filename"],
        target_lang=row["target_lang"],
        languageMode=_stored_language_mode(row["target_lang"]),
        video_url=f"/api/jobs/{job_id}/video",
    )


@router.get("/{job_id}/timing-debug")
async def get_job_timing_debug(
    job_id: str,
    current_time: float | None = Query(None, alias="currentTime"),
    db: aiosqlite.Connection = Depends(get_db),
):
    row = await get_owned_job(db, job_id)

    transcript = _load_json(row["transcript_json"] if "transcript_json" in row.keys() else None, None)
    segments = transcript.get("segments") if isinstance(transcript, dict) else None
    if not segments:
        segments = _load_json(row["segments_json"], [])
    metadata = transcript.get("metadata") if isinstance(transcript, dict) else {}
    timing = metadata.get("timing") if isinstance(metadata, dict) else {}
    vad = timing.get("vad") if isinstance(timing, dict) else {}
    sync = metadata.get("sync") if isinstance(metadata, dict) else {}
    report = timing.get("report") if isinstance(timing, dict) and isinstance(timing.get("report"), dict) else build_timing_report(segments, vad.get("silenceGaps") or [], sync)
    words = _flatten_word_debug(segments)
    auto_sync = sync.get("autoGlobalSync") if isinstance(sync, dict) else {}
    aligned_words = transcript.get("alignedWords") if isinstance(transcript, dict) and isinstance(transcript.get("alignedWords"), list) else canonical_aligned_words_from_segments(segments)
    aligned_word_debug = _flatten_word_debug([{"id": segment.get("id"), "words": segment.get("words") or []} for segment in segments])
    speech_segments = vad.get("speechSegments", []) if isinstance(vad, dict) and isinstance(vad.get("speechSegments"), list) else []
    quality = aligned_word_quality(segments)

    return {
        "jobId": job_id,
        "status": row["status"],
        "languageMode": _stored_language_mode(row["target_lang"]),
        "timingReport": report,
        "syncReport": sync or {},
        "first30Words": words[:30],
        "last30Words": words[-30:],
        "first50AlignedWords": aligned_word_debug[:50],
        "first100AlignedWordsAroundCurrentTime": _words_around_time(aligned_word_debug, current_time, 100),
        "captionTimingBasis": (sync.get("captionBuild") or {}).get("sourceOfTruth") if isinstance(sync, dict) else "unknown",
        "alignedWordCount": len(aligned_words),
        "estimatedWordCount": quality.get("estimatedWordCount", report.get("estimatedWordCount", 0)),
        "estimatedWordRatio": quality.get("estimatedWordRatio", 0),
        "timingNeedsReviewCount": quality.get("timingNeedsReviewCount", 0),
        "highQualityAlignmentLastRun": (sync.get("highQualityAlignment") or {}).get("lastRun") if isinstance(sync, dict) else None,
        **high_quality_alignment_status(),
        "autoSyncRejectReason": auto_sync.get("rejectReason") if isinstance(auto_sync, dict) else None,
        "speechSegments": speech_segments[:120],
        "captionGaps": classify_caption_gaps(segments, speech_segments),
        "suspiciousWarnings": report.get("warnings", []),
        "recommendedManualSync": {
            "shiftSeconds": auto_sync.get("shiftSeconds", 0) if isinstance(auto_sync, dict) else 0,
            "skew": auto_sync.get("skew", 1.0) if isinstance(auto_sync, dict) else 1.0,
            "reason": auto_sync.get("reason", "") if isinstance(auto_sync, dict) else "",
        },
        "pauseThresholdUsed": vad.get("thresholdSeconds") or DEFAULT_PAUSE_SPLIT_THRESHOLD if isinstance(vad, dict) else DEFAULT_PAUSE_SPLIT_THRESHOLD,
    }


@router.post("/{job_id}/sync/preview")
async def preview_sync(job_id: str, request: SyncRequest, db: aiosqlite.Connection = Depends(get_db)):
    row = await get_owned_job(db, job_id)
    segments = _load_json(row["segments_json"], [])
    before_words = _flatten_word_debug(segments)
    result = retime_segments(
        segments,
        shift_seconds=request.shiftSeconds,
        skew=request.skew,
        anchor_seconds=request.anchorSeconds,
        start_range=request.startRange,
        end_range=request.endRange,
    )
    after_words = _flatten_word_debug(result.segments)
    return {
        "jobId": job_id,
        "segments": result.segments,
        "beforeFirst10Words": before_words[:10],
        "afterFirst10Words": after_words[:10],
        "validationWarnings": result.report.get("warnings", []),
        "report": result.report,
    }


@router.post("/{job_id}/sync/apply")
async def apply_sync(job_id: str, request: SyncRequest, db: aiosqlite.Connection = Depends(get_db)):
    row = await get_owned_job(db, job_id)
    segments = _load_json(row["segments_json"], [])
    result = retime_segments(
        segments,
        shift_seconds=request.shiftSeconds,
        skew=request.skew,
        anchor_seconds=request.anchorSeconds,
        start_range=request.startRange,
        end_range=request.endRange,
    )
    transcript = _load_json(row["transcript_json"] if "transcript_json" in row.keys() else None, None)
    sync = _sync_metadata(transcript)
    sync["manualSync"] = result.report
    persisted = await _persist_synced_segments(db, job_id, row, result.segments, sync)
    return {"jobId": job_id, "applied": True, "report": result.report, **persisted}


@router.post("/{job_id}/sync/auto")
async def auto_sync(job_id: str, db: aiosqlite.Connection = Depends(get_db)):
    row = await get_owned_job(db, job_id)
    video_path = _video_path_for_row(job_id, row)
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Original media file not found for auto sync")
    segments = _load_json(row["segments_json"], [])
    transcript = _load_json(row["transcript_json"] if "transcript_json" in row.keys() else None, None)
    duration = ((transcript or {}).get("metadata") or {}).get("audio", {}).get("duration") if isinstance(transcript, dict) else None
    result = apply_auto_sync_if_confident(segments, video_path, duration_seconds=duration, config={"enabled": True})
    sync = _sync_metadata(transcript)
    sync["autoGlobalSync"] = result.report
    if result.report.get("applied"):
        persisted = await _persist_synced_segments(db, job_id, row, result.segments, sync)
        return {"jobId": job_id, "applied": True, "report": result.report, **persisted}
    return {
        "jobId": job_id,
        "applied": False,
        "autoSyncApplied": False,
        "rejectReason": result.report.get("rejectReason"),
        "userMessage": result.report.get("userMessage") or "Auto Sync returned a recommendation but did not apply.",
        "report": result.report,
        "segments": segments,
        "recommendation": result.report.get("recommendation") or {
            "shiftSeconds": result.report.get("shiftSeconds", 0),
            "skew": result.report.get("skew", 1.0),
            "quality": result.report.get("quality", 0),
            "reason": result.report.get("reason", ""),
        },
    }


@router.post("/{job_id}/sync/high-quality-align")
async def high_quality_align(job_id: str, db: aiosqlite.Connection = Depends(get_db)):
    row = await get_owned_job(db, job_id)
    video_path = _video_path_for_row(job_id, row)
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Original media file not found for high quality alignment")
    segments = _load_json(row["segments_json"], [])
    transcript = _load_json(row["transcript_json"] if "transcript_json" in row.keys() else None, None)
    language_mode = _stored_language_mode(row["target_lang"])
    result = await run_in_threadpool(run_high_quality_alignment, segments, video_path, language_mode)
    if not result.report.get("applied"):
        return JSONResponse(
            {
                "jobId": job_id,
                "applied": False,
                "report": result.report,
                "userMessage": result.report.get("userMessage"),
                "estimatedWordCount": result.report.get("estimatedWordCount"),
                "timingNeedsReviewCount": result.report.get("timingNeedsReviewCount"),
            },
            status_code=503 if result.report.get("reason") == "aligner_unavailable" else 200,
        )
    sync = _sync_metadata(transcript)
    sync["highQualityAlignment"] = {
        "lastRun": "completed",
        "engine": result.report.get("engine"),
        "report": result.report,
    }
    sync["captionBuild"] = result.report.get("captionBuild", {"sourceOfTruth": "alignedWords"})
    persisted = await _persist_synced_segments(db, job_id, row, result.segments, sync)
    return {
        "jobId": job_id,
        "applied": True,
        "report": result.report,
        "estimatedWordCount": result.report.get("estimatedWordCount"),
        "timingNeedsReviewCount": result.report.get("timingNeedsReviewCount"),
        **persisted,
    }


@router.get("/{job_id}/video")
async def get_video(job_id: str, db: aiosqlite.Connection = Depends(get_db)):
    """Stream the uploaded video file for browser playback."""
    from fastapi.responses import FileResponse
    
    r = await get_owned_job(db, job_id)
    await ensure_project_available(r, db)
    
    file_path = str(UPLOAD_DIR / f"{job_id}_{r['filename']}")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Video file not found")
    
    return FileResponse(file_path, media_type="video/mp4")

@router.post("/{job_id}/export")
async def export_video(
    job_id: str,
    db: aiosqlite.Connection = Depends(get_db),
    captions_json: str = Form(None),
    theme: str = Form("viral_shorts"),
    style_config_json: str = Form(None),
    ass_content: str = Form(None),
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
    composition_json: str | None = Form(None),
    visible_tracks_count: int | None = Form(None),
    source_media_count: int | None = Form(None),
    caption_chunks_count: int | None = Form(None),
    hardware_acceleration: bool = Form(False),
    response_format: str = Form("file"),
    render_mode: str = Form("headless"),
):
    """
    Export video with burned captions.
    
    render_mode='headless' (default): Pixel-perfect rendering via headless browser.
    render_mode='ass': Legacy ASS-based rendering via FFmpeg (faster but less accurate).
    """
    from fastapi.responses import FileResponse

    logger.info(f"EXPORT STARTED for job {job_id}, mode={render_mode}, resolution={resolution}")
    response_format = (response_format or "file").lower().strip()
    if response_format not in {"file", "json"}:
        return _export_failure("validate_request", "response_format must be either 'file' or 'json'.", "json", 400)
    export_mode = "captions_only" if captions_only else export_mode
    if duration_override is None and custom_duration is not None:
        duration_override = custom_duration
    if duration_source is None and duration_mode is not None:
        duration_source = duration_mode
    
    try:
        r = await get_owned_job(db, job_id)
    except HTTPException:
        return _export_failure("validate_project", "Job not found.", response_format, 404)
    await ensure_project_available(r, db)

    original_video_name = f"{job_id}_{r['filename']}"
    original_video_path = str(UPLOAD_DIR / original_video_name)
    is_captions_only_export = export_mode in {
        "captions_only",
        "captions_only_solid_background",
        "captions_solid_background",
    }
    if not os.path.exists(original_video_path) and not is_captions_only_export:
        return _export_failure("resolve_media", "Original video file not found. Re-upload the source media before full-video export.", response_format, 404)
    if not os.path.exists(original_video_path) and is_captions_only_export:
        include_audio = False
        logger.warning("captions_only_export_without_source_video job_id=%s", job_id)

    try:
        parsed_caption_count = len(json.loads(captions_json or "[]")) if captions_json else 0
    except json.JSONDecodeError:
        parsed_caption_count = -1
    _log_stage(
        job_id,
        "export_request",
        render_mode=render_mode,
        export_mode=export_mode,
        media_path=original_video_path,
        media_exists=os.path.exists(original_video_path),
        export_width=export_width,
        export_height=export_height,
        export_fps=export_fps,
        duration_override=duration_override,
        duration_source=duration_source,
        include_audio=include_audio,
        captions=caption_chunks_count if caption_chunks_count is not None else parsed_caption_count,
        visible_tracks=visible_tracks_count,
        source_media=source_media_count,
        composition_json_bytes=len(composition_json or ""),
    )

    # ── HEADLESS BROWSER EXPORT (pixel-perfect) ──
    if render_mode == "headless" and captions_json:
        from ..headless_export import ExportStageError, export_headless

        async def progress_cb(status: str, percent: int, details: str):
            await manager.broadcast(job_id, {
                "status": status, "percent": percent, "details": details
            })

        try:
            if theme == "word_highlight_box":
                try:
                    parsed_captions = json.loads(captions_json)
                except json.JSONDecodeError:
                    return _export_failure("validate_request", "Invalid captions JSON.", response_format, 400)
            output_path = await export_headless(
                job_id=job_id,
                source_job_id=job_id,
                video_path=original_video_path,
                captions_json=captions_json,
                theme=theme,
                resolution=resolution,
                progress_callback=progress_cb,
                style_config_json=style_config_json,
                export_width=export_width,
                export_height=export_height,
                export_fps=export_fps,
                include_audio=include_audio,
                quality=quality,
                bitrate=bitrate,
                custom_bitrate_mbps=custom_bitrate_mbps,
                export_mode=export_mode,
                background_color=background_color,
                duration_override=duration_override,
                duration_source=duration_source,
                composition_json=composition_json,
                hardware_acceleration=hardware_acceleration,
            )
            output_filename = Path(output_path).name
            output_bytes = os.path.getsize(output_path)
            if output_bytes <= 0:
                return _export_failure("write_output", "Export finished but the MP4 file is empty.", response_format)
            download_url = _export_download_url(output_filename)
            if response_format == "json":
                fallback_width, fallback_height = _resolve_export_dimensions(resolution, export_width, export_height)
                width, height = _dimensions_from_export_filename(output_filename, fallback_width, fallback_height)
                await manager.broadcast(job_id, {
                    "status": "export_complete", "percent": 100, "details": "MP4 export is ready to download."
                })
                return {
                    "success": True,
                    "exportJobId": Path(output_filename).stem,
                    "downloadUrl": download_url,
                    "filename": output_filename,
                    "duration": float(duration_override or 0),
                    "width": width,
                    "height": height,
                    "fps": export_fps,
                    "bytes": output_bytes,
                }
            return FileResponse(
                output_path,
                media_type="video/mp4",
                filename=f"captioned_{export_width or resolution}_{r['filename']}",
                headers={
                    "X-Export-File": output_filename,
                    "X-Export-Url": download_url,
                    "X-Export-Bytes": str(output_bytes),
                },
            )
        except HTTPException:
            raise
        except ExportStageError as e:
            public_stage = _public_export_stage(e.stage)
            detail = f"Export failed during {public_stage}: {e}"
            logger.exception("headless_export_stage_failed job_id=%s stage=%s detail=%s", job_id, e.stage, e)
            await manager.broadcast(job_id, {
                "status": "export_failed", "percent": -1, "details": detail
            })
            return _export_failure(public_stage, str(e), response_format)
        except Exception as e:
            error_message = str(e).strip() or repr(e) or type(e).__name__
            detail = f"Export failed during render_video: {type(e).__name__}: {error_message}"
            logger.exception("headless_export_failed_without_stage job_id=%s detail=%s", job_id, detail)
            await manager.broadcast(job_id, {
                "status": "export_failed", "percent": -1, "details": detail
            })
            return _export_failure("render_video", f"{type(e).__name__}: {error_message}", response_format)

    # ── LEGACY ASS EXPORT (fallback) ──
    if not ass_content or not ass_content.strip():
        return _export_failure("validate_request", "No captions data provided (need captions_json or ass_content).", response_format, 400)
        
    if "[Script Info]" not in ass_content or "[Events]" not in ass_content:
        return _export_failure("validate_request", "Invalid ASS content format.", response_format, 400)

    await manager.broadcast(job_id, {"status": "export_started", "percent": 0, "details": "Preparing export..."})

    ass_filename = f"{job_id}_temp.ass"
    ass_filepath = str(UPLOAD_DIR / ass_filename)
    with open(ass_filepath, 'w', encoding='utf-8') as f:
        f.write(ass_content)

    output_dims = None
    if export_width and export_height and export_width > 0 and export_height > 0:
        output_dims = (int(export_width), int(export_height))

    output_suffix = f"{output_dims[0]}x{output_dims[1]}" if output_dims else resolution
    output_filename = f"{job_id}_exported_{output_suffix}.mp4"
    output_filepath = str(EXPORT_DIR / output_filename)

    scale_filter = ""
    if output_dims:
        target_w, target_h = output_dims
        scale_filter = (
            f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
            f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,"
        )

    vf_string = f"{scale_filter}ass={ass_filename}"

    total_duration = 0.0
    try:
        probe_cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            original_video_name,
        ]
        probe_proc = await asyncio.create_subprocess_exec(
            *probe_cmd, cwd=str(UPLOAD_DIR),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        probe_out, _ = await probe_proc.communicate()
        total_duration = float(probe_out.decode().strip())
    except Exception:
        logger.warning(f"ffprobe failed for {original_video_name}")

    await manager.broadcast(job_id, {"status": "exporting", "percent": 1, "details": "Burning subtitles..."})

    ffmpeg_cmd = [
        "ffmpeg", "-y", "-i", original_video_name,
        "-vf", vf_string,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-c:a", "copy", "-progress", "pipe:1",
        str(EXPORT_DIR / output_filename),
    ]

    try:
        process = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd, cwd=str(UPLOAD_DIR),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        last_broadcast_pct = 0
        while process.stdout:
            line_bytes = await process.stdout.readline()
            if not line_bytes:
                break
            line = line_bytes.decode("utf-8", errors="replace").strip()
            if line.startswith("out_time_us="):
                try:
                    time_us = int(line.split("=", 1)[1])
                    current_secs = time_us / 1_000_000
                    pct = min(99, int((current_secs / total_duration) * 100)) if total_duration > 0 else min(90, last_broadcast_pct + 1)
                    if pct >= last_broadcast_pct + 2:
                        last_broadcast_pct = pct
                        await manager.broadcast(job_id, {"status": "exporting", "percent": pct, "details": f"Rendering video... {pct}%"})
                except (ValueError, IndexError):
                    pass
        await process.wait()
        if process.returncode != 0:
            stderr_bytes = await process.stderr.read() if process.stderr else b""
            logger.error(f"FFmpeg subtitle burn failed: {stderr_bytes.decode()}")
            await manager.broadcast(job_id, {"status": "export_failed", "percent": -1, "details": "FFmpeg error"})
            raise HTTPException(status_code=500, detail="Failed to burn subtitles into video.")
        await manager.broadcast(job_id, {"status": "export_complete", "percent": 100, "details": "Done!"})
    except Exception as e:
        logger.error(f"Export exception: {e}")
        await manager.broadcast(job_id, {"status": "export_failed", "percent": -1, "details": str(e)})
        raise HTTPException(status_code=500, detail="Export process failed.")
    finally:
        if os.path.exists(ass_filepath):
            os.remove(ass_filepath)

    if response_format == "json":
        if not os.path.exists(output_filepath) or os.path.getsize(output_filepath) <= 0:
            return _export_failure("write_output", "ASS export finished but the MP4 file is missing or empty.", response_format)
        width, height = _resolve_export_dimensions(resolution, export_width, export_height)
        return {
            "success": True,
            "exportJobId": Path(output_filename).stem,
            "downloadUrl": _export_download_url(output_filename),
            "filename": output_filename,
            "duration": total_duration,
            "width": width,
            "height": height,
            "fps": export_fps,
            "bytes": os.path.getsize(output_filepath),
        }

    return FileResponse(
        output_filepath,
        media_type="video/mp4",
        filename=f"captioned_{r['filename']}",
        headers={
            "X-Export-File": output_filename,
            "X-Export-Url": _export_download_url(output_filename),
            "X-Export-Bytes": str(os.path.getsize(output_filepath)) if os.path.exists(output_filepath) else "0",
        },
    )

@router.websocket("/{job_id}/ws")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    """
    WebSocket endpoint for real-time progress updates of a specific job.
    """
    token = websocket.query_params.get("access_token", "")
    try:
        user = verify_access_token(token)
    except HTTPException:
        await websocket.close(code=4401)
        return
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT 1 FROM jobs WHERE id = ? AND user_id = ?",
            (job_id, user.id),
        )
        if not await cursor.fetchone():
            await websocket.close(code=4404)
            return
    await manager.connect(websocket, job_id)
    try:
        while True:
            # We expect the client to keep the connection alive but we don't 
            # expect it to send commands.
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket, job_id)
