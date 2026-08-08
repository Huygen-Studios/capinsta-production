import shutil
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException

from .settings import (
    DISK_CRITICAL_FREE_BYTES,
    DISK_REJECT_UPLOAD_FREE_BYTES,
    DISK_WARNING_FREE_BYTES,
    TEMP_DIR,
    UPLOAD_DIR,
)


@dataclass(frozen=True)
class DiskPressure:
    total_bytes: int
    used_bytes: int
    free_bytes: int
    level: str


def read_disk_pressure(root: Path = TEMP_DIR) -> DiskPressure:
    usage = shutil.disk_usage(root)
    if usage.free <= DISK_CRITICAL_FREE_BYTES:
        level = "critical"
    elif usage.free <= DISK_REJECT_UPLOAD_FREE_BYTES:
        level = "rejecting_new_work"
    elif usage.free <= DISK_WARNING_FREE_BYTES:
        level = "warning"
    else:
        level = "healthy"
    return DiskPressure(
        total_bytes=usage.total,
        used_bytes=usage.used,
        free_bytes=usage.free,
        level=level,
    )


def require_disk_capacity(*, operation: str, required_bytes: int = 0) -> DiskPressure:
    root = UPLOAD_DIR if operation == "upload" else TEMP_DIR
    pressure = read_disk_pressure(root)
    needed = max(0, required_bytes)
    if operation == "upload":
        needed *= 2
    projected_free = pressure.free_bytes - needed
    threshold = (
        DISK_CRITICAL_FREE_BYTES
        if operation == "export"
        else DISK_REJECT_UPLOAD_FREE_BYTES
    )
    if projected_free <= threshold:
        raise HTTPException(
            status_code=507,
            detail={
                "code": "insufficient_server_storage",
                "operation": operation,
                "freeBytes": pressure.free_bytes,
                "requiredBytes": needed,
                "message": (
                    "Capinsta is temporarily low on server storage. "
                    "Please retry after older projects and exports are cleaned up."
                ),
            },
        )
    return pressure
