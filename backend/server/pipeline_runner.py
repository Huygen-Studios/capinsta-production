import os
import json
import asyncio
import logging
import re
from datetime import datetime, timezone
from threading import Event, Thread
from ai_pipeline.main import run_pipeline
from ai_pipeline.sync.final_quality_gate import has_timed_caption_content
from .database import DB_PATH
import aiosqlite
from .progress import manager
from .operational_mirror import mirror_caption_job
from .transcription_control import record_provider_failure, record_provider_success

logger = logging.getLogger(__name__)


def _utc_now_text() -> str:
    return datetime.now(timezone.utc).isoformat()


class PipelineCancelled(RuntimeError):
    pass


def _log_stage(job_id: str, stage: str, **fields):
    details = " ".join(f"{key}={value!r}" for key, value in fields.items())
    logger.info("job_stage job_id=%s stage=%s %s", job_id, stage, details)


async def get_job_status(job_id: str) -> str | None:
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute("SELECT status FROM jobs WHERE id = ?", (job_id,))
        row = await cursor.fetchone()
        return row[0] if row else None


async def is_job_cancelled(job_id: str) -> bool:
    return await get_job_status(job_id) == "cancelled"


async def update_job_status(job_id: str, status: str, progress: int = None, 
                            error: str = None, srt: str = None, vtt: str = None,
                            segments: list = None, transcript: dict = None,
                            message: str | None = None, metrics: dict = None) -> bool:
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute("SELECT status, progress FROM jobs WHERE id = ?", (job_id,))
        current = await cursor.fetchone()
        if current and current[0] == "cancelled" and status != "cancelled":
            _log_stage(job_id, "status update skipped", requested_status=status, current_status="cancelled")
            return False
        
        updates = []
        params = []
        
        updates.append("status = ?")
        params.append(status)
        
        now_text = _utc_now_text()
        updates.append("heartbeat_at = ?")
        params.append(now_text)
        updates.append("updated_at = ?")
        params.append(now_text)

        if status not in {"queued", "completed", "failed", "cancelled"}:
            updates.append("started_at = COALESCE(started_at, ?)")
            params.append(now_text)

        if progress is not None:
            if progress >= 0 and current and current[1] is not None and int(current[1]) >= 0:
                progress = max(progress, int(current[1]))
            updates.append("progress = ?")
            params.append(progress)

        if message is not None:
            updates.append("message = ?")
            params.append(message[:500])
            chunk_match = re.search(r"chunk\s+(\d+)\s+of\s+(\d+)", message, re.IGNORECASE)
            if chunk_match:
                updates.append("current_chunk = ?")
                params.append(int(chunk_match.group(1)))
                updates.append("total_chunks = ?")
                params.append(int(chunk_match.group(2)))
            provider_match = re.search(r"with\s+([A-Za-z0-9 _-]+?)(?:\.|$)", message)
            if provider_match:
                updates.append("current_provider = ?")
                params.append(provider_match.group(1).strip().lower().replace(" ", "_"))
            
        if error is not None:
            updates.append("error = ?")
            params.append(error)
            
        if srt is not None:
            updates.append("srt_content = ?")
            params.append(srt)
            
        if vtt is not None:
            updates.append("vtt_content = ?")
            params.append(vtt)

        if segments is not None:
            updates.append("segments_json = ?")
            params.append(json.dumps(segments, ensure_ascii=False))

        if transcript is not None:
            updates.append("transcript_json = ?")
            params.append(json.dumps(transcript, ensure_ascii=False))
            provider = transcript.get("provider") if isinstance(transcript, dict) else None
            if isinstance(provider, dict):
                updates.append("transcription_provider = COALESCE(transcription_provider, ?)")
                params.append(provider.get("name"))
                updates.append("transcription_model = COALESCE(transcription_model, ?)")
                params.append(provider.get("model"))
                updates.append("timestamp_strategy = COALESCE(timestamp_strategy, ?)")
                params.append(provider.get("timestampStrategy"))
                updates.append("provider_mode = COALESCE(provider_mode, ?)")
                params.append(provider.get("providerMode"))
                if provider.get("configurationVersion") is not None:
                    updates.append("transcription_config_version = COALESCE(transcription_config_version, ?)")
                    params.append(provider.get("configurationVersion"))
            metadata = transcript.get("metadata") if isinstance(transcript, dict) else None
            if isinstance(metadata, dict):
                timing = metadata.get("timing")
                if isinstance(timing, dict):
                    if isinstance(timing.get("resolvedPipelineOptions"), dict):
                        updates.append("pipeline_options_json = ?")
                        params.append(json.dumps(timing.get("resolvedPipelineOptions") or {}, ensure_ascii=False))
                    report = timing.get("report")
                    if isinstance(report, dict):
                        updates.append("timing_source_summary_json = ?")
                        params.append(json.dumps(report.get("timingSourceCounts") or {}, ensure_ascii=False))
        if metrics is not None:
            updates.append("metrics_json = ?")
            params.append(json.dumps(metrics, ensure_ascii=False))

        if status in ['completed', 'failed', 'cancelled']:
            updates.append("completed_at = CURRENT_TIMESTAMP")
            
        query = f"UPDATE jobs SET {', '.join(updates)} WHERE id = ?"
        params.append(job_id)
        
        await db.execute(query, tuple(params))
        await db.commit()
        await mirror_caption_job(job_id)
        return True


async def update_job_heartbeat(job_id: str) -> bool:
    now_text = _utc_now_text()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute("SELECT status FROM jobs WHERE id = ?", (job_id,))
        row = await cursor.fetchone()
        if not row or row[0] in {"completed", "failed", "cancelled"}:
            return False
        await db.execute(
            "UPDATE jobs SET heartbeat_at = ?, updated_at = ? WHERE id = ?",
            (now_text, now_text, job_id),
        )
        await db.commit()
        return True


def _start_job_heartbeat(job_id: str, stop_event: Event) -> Thread:
    interval_seconds = max(5, int(os.getenv("CAPTION_JOB_HEARTBEAT_INTERVAL_SECONDS", "15")))

    def heartbeat_loop():
        while not stop_event.wait(interval_seconds):
            try:
                alive = asyncio.run(update_job_heartbeat(job_id))
                if alive:
                    logger.info("caption_job_heartbeat job_id=%s", job_id)
                else:
                    return
            except Exception:
                logger.warning("caption_job_heartbeat_failed job_id=%s", job_id, exc_info=True)

    thread = Thread(target=heartbeat_loop, name=f"caption-job-heartbeat-{job_id}", daemon=True)
    thread.start()
    return thread

def run_pipeline_sync(
    job_id: str,
    video_path: str,
    target_lang: str,
    *,
    caption_output: str = "original",
    transcription_config_snapshot: dict | None = None,
    cancel_event: Event | None = None,
):
    """
    Synchronous wrapper to run the pipeline.
    This runs in a separate thread with its own event loop.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    heartbeat_stop = Event()
    heartbeat_thread = _start_job_heartbeat(job_id, heartbeat_stop)
    
    def on_progress(status: str, percent: int, details: str = ""):
        if cancel_event and cancel_event.is_set():
            raise PipelineCancelled("Caption generation was cancelled.")
        if loop.run_until_complete(is_job_cancelled(job_id)):
            raise PipelineCancelled("Caption generation was cancelled.")
        # Update DB via this thread's own event loop
        updated = loop.run_until_complete(update_job_status(job_id, status, percent, message=details))
        if not updated:
            return
        # Broadcast WebSocket progress — broadcast_progress uses threading.Lock
        # so it's safe to call from any event loop
        loop.run_until_complete(manager.broadcast_progress(job_id, status, percent, details))

    try:
        # 1. Fetch job range and asset details from DB
        media_asset_id = None
        source_in_ms = None
        source_out_ms = None
        timeline_offset_ms = None
        try:
            async def fetch_job_details():
                async with aiosqlite.connect(str(DB_PATH)) as db:
                    db.row_factory = aiosqlite.Row
                    cursor = await db.execute(
                        "SELECT media_asset_id, source_in_ms, source_out_ms, timeline_offset_ms FROM jobs WHERE id = ?",
                        (job_id,)
                    )
                    row = await cursor.fetchone()
                    if row:
                        return (
                            row["media_asset_id"],
                            row["source_in_ms"],
                            row["source_out_ms"],
                            row["timeline_offset_ms"]
                        )
                    return None, None, None, None
            media_asset_id, source_in_ms, source_out_ms, timeline_offset_ms = loop.run_until_complete(fetch_job_details())
        except Exception as e:
            logger.warning(f"Failed to fetch job details for job {job_id}: {e}")

        # 2. Compute audio fingerprint
        fingerprint = ""
        if video_path:
            try:
                stat = os.stat(video_path)
                fingerprint = f"{stat.st_size}_{stat.st_mtime}"
            except Exception as e:
                logger.warning(f"Failed to compute file fingerprint for {video_path}: {e}")

        preset_name = "fast"
        if transcription_config_snapshot:
            if isinstance(transcription_config_snapshot, dict):
                preset_name = transcription_config_snapshot.get("preset_id") or transcription_config_snapshot.get("preset") or "fast"
            else:
                preset_name = getattr(transcription_config_snapshot, "preset_id", None) or getattr(transcription_config_snapshot, "preset", None) or "fast"

        # 3. Check for cached entry in caption_artifacts
        cached_entry = None
        if media_asset_id and fingerprint:
            try:
                async def check_cache():
                    async with aiosqlite.connect(str(DB_PATH)) as db:
                        db.row_factory = aiosqlite.Row
                        cursor = await db.execute(
                            """
                            SELECT id, segments_json, transcript_json, srt_content, vtt_content
                            FROM caption_artifacts
                            WHERE media_asset_id = ? AND audio_fingerprint = ? AND language_mode = ? AND output_language = ? AND preset = ?
                              AND source_in_ms IS ? AND source_out_ms IS ? AND timeline_offset_ms IS ?
                            """,
                            (media_asset_id, fingerprint, target_lang, caption_output, preset_name, source_in_ms, source_out_ms, timeline_offset_ms)
                        )
                        return await cursor.fetchone()
                cached_entry = loop.run_until_complete(check_cache())
            except Exception as e:
                logger.warning(f"Failed to query caption_artifacts for job {job_id}: {e}")

        if cached_entry:
            try:
                cached_segments = json.loads(cached_entry["segments_json"] or "[]")
            except (TypeError, json.JSONDecodeError):
                cached_segments = []
            if not has_timed_caption_content(cached_segments):
                _log_stage(
                    job_id,
                    "invalid cache entry discarded",
                    artifact_id=cached_entry["id"],
                    reason="no_timed_caption_content",
                )
                async def delete_invalid_cache():
                    async with aiosqlite.connect(str(DB_PATH)) as db:
                        await db.execute(
                            "DELETE FROM caption_artifacts WHERE id = ?",
                            (cached_entry["id"],),
                        )
                        await db.commit()
                loop.run_until_complete(delete_invalid_cache())
                cached_entry = None

        if cached_entry:
            _log_stage(job_id, "cache hit", media_asset_id=media_asset_id, preset=preset_name)
            on_progress("completed", 100, "Captioning completed (cache hit).")
            
            segments = json.loads(cached_entry["segments_json"])
            transcript = json.loads(cached_entry["transcript_json"])
            srt = cached_entry["srt_content"]
            vtt = cached_entry["vtt_content"]
            
            metrics = {
                "cache_hit": True,
                "durations": {"total": 0.0},
            }
            
            updated = loop.run_until_complete(
                update_job_status(
                    job_id, "completed", 100,
                    srt=srt, vtt=vtt,
                    segments=segments,
                    transcript=transcript,
                    metrics=metrics,
                )
            )
            if updated:
                record_provider_success(transcription_config_snapshot)
                loop.run_until_complete(
                    manager.broadcast_progress(job_id, "completed", 100, "Captioning finished successfully.")
                )
                _log_stage(job_id, "response returned", status="completed", cache_hit=True)
                return

        # Cache miss, run the pipeline
        _log_stage(job_id, "pipeline started", video_path=video_path, language_mode=target_lang)
        on_progress("extracting_audio", 1, "Pipeline started.")
        
        result = run_pipeline(
            video_path=video_path,
            user_target_lang=target_lang,
            caption_output=caption_output,
            transcription_config_snapshot=transcription_config_snapshot,
            progress_callback=on_progress,
            source_in_ms=source_in_ms,
            source_out_ms=source_out_ms,
            timeline_offset_ms=timeline_offset_ms,
        )

        if loop.run_until_complete(is_job_cancelled(job_id)):
            _log_stage(job_id, "pipeline result ignored", status="cancelled")
            return
        
        if result["status"] == "success":
            if not has_timed_caption_content(result.get("segments")):
                raise RuntimeError(
                    "no_timed_caption_content: Caption processing produced no usable timed speech. "
                    "Check that the selected media has an audible speech track and retry."
                )
            logger.info(f"Job {job_id} Completed successfully")
            
            # Save to cache
            if media_asset_id and fingerprint:
                try:
                    import uuid
                    artifact_id = str(uuid.uuid4())
                    async def save_cache():
                        async with aiosqlite.connect(str(DB_PATH)) as db:
                            await db.execute(
                                """
                                INSERT INTO caption_artifacts (
                                    id, media_asset_id, audio_fingerprint, language_mode, output_language, preset,
                                    source_in_ms, source_out_ms, timeline_offset_ms,
                                    segments_json, transcript_json, srt_content, vtt_content, created_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                (
                                    artifact_id,
                                    media_asset_id,
                                    fingerprint,
                                    target_lang,
                                    caption_output,
                                    preset_name,
                                    source_in_ms,
                                    source_out_ms,
                                    timeline_offset_ms,
                                    json.dumps(result.get("segments") or []),
                                    json.dumps(result.get("transcript") or {}),
                                    result.get("srt"),
                                    result.get("vtt"),
                                    _utc_now_text()
                                )
                            )
                            await db.commit()
                    loop.run_until_complete(save_cache())
                except Exception as e:
                    logger.warning(f"Failed to save caption_artifact for job {job_id}: {e}")

            # Collect metrics
            metrics = {
                "cache_hit": False,
                "durations": result.get("transcript", {}).get("metadata", {}).get("timing", {}).get("report", {}).get("durations", {}),
                "concurrency": int(os.getenv("SARVAM_MAX_CONCURRENCY_PER_JOB", "4")),
                "retries": result.get("transcript", {}).get("metadata", {}).get("timing", {}).get("report", {}).get("retryAttempts", []),
                "timingSourceCounts": result.get("transcript", {}).get("metadata", {}).get("timing", {}).get("report", {}).get("timingSourceCounts", {}),
                "chunks": result.get("transcript", {}).get("metadata", {}).get("timing", {}).get("report", {}).get("chunkValidations", []),
            }

            updated = loop.run_until_complete(
                update_job_status(
                    job_id, "completed", 100, 
                    srt=result.get("srt"), vtt=result.get("vtt"),
                    segments=result.get("segments"),
                    transcript=result.get("transcript"),
                    metrics=metrics,
                )
            )
            if not updated:
                _log_stage(job_id, "completed broadcast skipped", current_status="cancelled")
                return
            record_provider_success(transcription_config_snapshot)
            loop.run_until_complete(
                manager.broadcast_progress(job_id, "completed", 100, "Captioning finished successfully.")
            )
            _log_stage(job_id, "response returned", status="completed")
        else:
            if loop.run_until_complete(is_job_cancelled(job_id)):
                _log_stage(job_id, "pipeline failure ignored", status="cancelled")
                return
            err_msg = result.get("message", "Unknown pipeline error")
            logger.error(f"Job {job_id} Failed gracefully: {err_msg}")
            
            # Save failure metrics if applicable
            metrics = {
                "cache_hit": False,
                "error": err_msg,
            }
            
            updated = loop.run_until_complete(update_job_status(job_id, "failed", progress=-1, error=err_msg, metrics=metrics))
            if not updated:
                _log_stage(job_id, "failed broadcast skipped", current_status="cancelled")
                return
            record_provider_failure(transcription_config_snapshot, retryable=True)
            loop.run_until_complete(manager.broadcast_progress(job_id, "failed", 0, err_msg))
            _log_stage(job_id, "response returned", status="failed", error=err_msg)

    except PipelineCancelled:
        _log_stage(job_id, "pipeline cancelled", status="cancelled")
        return
    except Exception as e:
        logger.exception(f"Job {job_id} Pipeline crashed.")
        try:
            if loop.run_until_complete(is_job_cancelled(job_id)):
                _log_stage(job_id, "pipeline crash ignored", status="cancelled")
                return
            metrics = {
                "cache_hit": False,
                "error": str(e),
                "crash": True,
            }
            updated = loop.run_until_complete(update_job_status(job_id, "failed", progress=-1, error=str(e), metrics=metrics))
            if not updated:
                return
            record_provider_failure(transcription_config_snapshot, retryable=True)
        except Exception:
            logger.error(f"Job {job_id} Failed to update DB after crash")
        try:
            loop.run_until_complete(manager.broadcast_progress(job_id, "failed", 0, str(e)))
        except Exception:
            logger.error(f"Job {job_id} Failed to broadcast after crash")
        
    finally:
        heartbeat_stop.set()
        heartbeat_thread.join(timeout=2)
        loop.close()
