from __future__ import annotations

import asyncio
import shutil
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from uuid import UUID

from server.clipping_jobs.errors import ProcessingJobFailure


def _confined(root: Path, target: Path) -> Path:
    resolved_root = root.resolve()
    resolved = target.resolve()
    if resolved == resolved_root or resolved_root not in resolved.parents:
        raise ProcessingJobFailure(
            "temporary_storage_unavailable",
            "The media-variant workspace escaped its trusted root",
            retryable=True,
        )
    return resolved


@asynccontextmanager
async def temporary_workspace(
    root: Path, *, job_id: UUID, attempt_number: int, maximum_bytes: int
):
    workspace = _confined(root, root / str(job_id) / str(attempt_number))
    try:
        await asyncio.to_thread(workspace.mkdir, parents=True, exist_ok=True)
        usage = await asyncio.to_thread(shutil.disk_usage, workspace)
        if usage.free < maximum_bytes:
            raise ProcessingJobFailure(
                "temporary_disk_limit_exceeded",
                "The worker does not have enough temporary disk capacity",
                retryable=True,
            )
        yield workspace
    except OSError as exc:
        raise ProcessingJobFailure(
            "temporary_storage_unavailable",
            "The media-variant temporary workspace is unavailable",
            retryable=True,
        ) from exc
    finally:
        if workspace.exists():
            await asyncio.to_thread(shutil.rmtree, workspace, True)
        parent = workspace.parent
        with suppress(OSError):
            parent.rmdir()


__all__ = ["temporary_workspace"]
