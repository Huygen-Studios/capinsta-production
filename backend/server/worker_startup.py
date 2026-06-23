import asyncio
import importlib
import logging
import traceback
from threading import Event, Lock, Thread
from typing import Any

import aiosqlite

from .database import DB_PATH
from .progress import manager

logger = logging.getLogger(__name__)
_workers_lock = Lock()
_workers: dict[str, tuple[Thread, Event]] = {}


def format_worker_startup_error(error: BaseException) -> str:
    if isinstance(error, ModuleNotFoundError):
        missing_name = getattr(error, "name", None)
        if missing_name:
            return (
                f"Caption worker dependency is missing: {missing_name}. "
                "Install backend requirements in the Python environment used to start the server."
            )
    return f"Caption worker failed to start: {type(error).__name__}: {error}"


def import_pipeline_runner():
    return importlib.import_module("server.pipeline_runner")


def check_pipeline_worker_import() -> dict[str, Any]:
    try:
        import_pipeline_runner()
        importlib.import_module("ai_pipeline.main")
        return {"ok": True, "error": None}
    except BaseException as error:
        return {
            "ok": False,
            "error": format_worker_startup_error(error),
            "exceptionType": type(error).__name__,
        }


async def mark_job_failed_from_worker_startup(
    *,
    job_id: str,
    error_message: str,
) -> None:
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute("SELECT status FROM jobs WHERE id = ?", (job_id,))
        row = await cursor.fetchone()
        if not row or row[0] in {"completed", "failed", "cancelled"}:
            return

        await db.execute(
            """
            UPDATE jobs
            SET status = 'failed',
                progress = -1,
                error = ?,
                completed_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (error_message, job_id),
        )
        await db.commit()

    await manager.broadcast_progress(job_id, "failed", -1, error_message)


def start_pipeline_worker(
    *,
    job_id: str,
    file_path: str,
    language_mode: str,
    caption_output: str = "original",
) -> Thread:
    cancel_event = Event()

    def pipeline_thread_target() -> None:
        try:
            pipeline_runner = import_pipeline_runner()
            pipeline_runner.run_pipeline_sync(
                job_id,
                file_path,
                language_mode,
                caption_output=caption_output,
                cancel_event=cancel_event,
            )
        except BaseException as error:
            error_message = format_worker_startup_error(error)
            logger.error(
                "caption_worker_startup_failed job_id=%s error=%s\n%s",
                job_id,
                error_message,
                traceback.format_exc(),
            )
            try:
                asyncio.run(
                    mark_job_failed_from_worker_startup(
                        job_id=job_id,
                        error_message=error_message,
                    ),
                )
            except BaseException:
                logger.exception("Failed to persist caption worker startup error")
        finally:
            with _workers_lock:
                _workers.pop(job_id, None)

    thread = Thread(target=pipeline_thread_target)
    thread.daemon = True
    with _workers_lock:
        _workers[job_id] = (thread, cancel_event)
    thread.start()
    return thread


async def cancel_pipeline_workers(
    job_ids: list[str], *, timeout_seconds: float = 60.0
) -> list[str]:
    with _workers_lock:
        workers = [
            (job_id, *_workers[job_id])
            for job_id in job_ids
            if job_id in _workers
        ]
    for _, _, cancel_event in workers:
        cancel_event.set()
    timed_out: list[str] = []
    for job_id, thread, _ in workers:
        await asyncio.to_thread(thread.join, timeout_seconds)
        if thread.is_alive():
            timed_out.append(job_id)
    return timed_out
