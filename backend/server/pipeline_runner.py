import os
import json
import asyncio
import logging
from threading import Event
from ai_pipeline.main import run_pipeline
from .database import DB_PATH
import aiosqlite
from .progress import manager
from .operational_mirror import mirror_caption_job

logger = logging.getLogger(__name__)


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
                            segments: list = None, transcript: dict = None) -> bool:
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute("SELECT status FROM jobs WHERE id = ?", (job_id,))
        current = await cursor.fetchone()
        if current and current[0] == "cancelled" and status != "cancelled":
            _log_stage(job_id, "status update skipped", requested_status=status, current_status="cancelled")
            return False
        
        updates = []
        params = []
        
        updates.append("status = ?")
        params.append(status)
        
        if progress is not None:
            updates.append("progress = ?")
            params.append(progress)
            
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
            
        if status in ['completed', 'failed', 'cancelled']:
            updates.append("completed_at = CURRENT_TIMESTAMP")
            
        query = f"UPDATE jobs SET {', '.join(updates)} WHERE id = ?"
        params.append(job_id)
        
        await db.execute(query, tuple(params))
        await db.commit()
        await mirror_caption_job(job_id)
        return True

def run_pipeline_sync(
    job_id: str,
    video_path: str,
    target_lang: str,
    *,
    cancel_event: Event | None = None,
):
    """
    Synchronous wrapper to run the pipeline.
    This runs in a separate thread with its own event loop.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    def on_progress(status: str, percent: int, details: str = ""):
        if cancel_event and cancel_event.is_set():
            raise PipelineCancelled("Caption generation was cancelled.")
        if loop.run_until_complete(is_job_cancelled(job_id)):
            raise PipelineCancelled("Caption generation was cancelled.")
        # Update DB via this thread's own event loop
        updated = loop.run_until_complete(update_job_status(job_id, status, percent))
        if not updated:
            return
        # Broadcast WebSocket progress — broadcast_progress uses threading.Lock
        # so it's safe to call from any event loop
        loop.run_until_complete(manager.broadcast_progress(job_id, status, percent, details))

    try:
        _log_stage(job_id, "pipeline started", video_path=video_path, language_mode=target_lang)
        on_progress("extracting_audio", 1, "Pipeline started.")
        
        result = run_pipeline(
            video_path=video_path,
            user_target_lang=target_lang,
            progress_callback=on_progress
        )

        if loop.run_until_complete(is_job_cancelled(job_id)):
            _log_stage(job_id, "pipeline result ignored", status="cancelled")
            return
        
        if result["status"] == "success":
            logger.info(f"Job {job_id} Completed successfully")
            updated = loop.run_until_complete(
                update_job_status(
                    job_id, "completed", 100, 
                    srt=result.get("srt"), vtt=result.get("vtt"),
                    segments=result.get("segments"),
                    transcript=result.get("transcript"),
                )
            )
            if not updated:
                _log_stage(job_id, "completed broadcast skipped", current_status="cancelled")
                return
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
            updated = loop.run_until_complete(update_job_status(job_id, "failed", progress=-1, error=err_msg))
            if not updated:
                _log_stage(job_id, "failed broadcast skipped", current_status="cancelled")
                return
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
            updated = loop.run_until_complete(update_job_status(job_id, "failed", progress=-1, error=str(e)))
            if not updated:
                return
        except Exception:
            logger.error(f"Job {job_id} Failed to update DB after crash")
        try:
            loop.run_until_complete(manager.broadcast_progress(job_id, "failed", 0, str(e)))
        except Exception:
            logger.error(f"Job {job_id} Failed to broadcast after crash")
        
    finally:
        loop.close()
