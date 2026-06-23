"""Dry-run-first production storage maintenance for Capinsta.

Run from the backend container/app directory:
  python scripts/storage_maintenance.py
  python scripts/storage_maintenance.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import aiosqlite

from server.database import DB_PATH
from server.settings import (
    ABANDONED_UPLOAD_RETENTION_HOURS,
    CACHE_DIR,
    DOWNLOAD_ARTIFACT_RETENTION_HOURS,
    EXPORT_DIR,
    FAILED_EXPORT_RETENTION_HOURS,
    MEDIA_DIR,
    TEMP_AUDIO_RETENTION_HOURS,
    TEMP_DIR,
    UPLOAD_DIR,
)
from server.storage_retention import cleanup_retained_storage


APPROVED_ROOTS = {
    "temp": TEMP_DIR,
    "uploads": UPLOAD_DIR,
    "exports": EXPORT_DIR,
    "media": MEDIA_DIR,
    "cache": CACHE_DIR,
}


def _inside_approved_root(path: Path) -> bool:
    try:
        resolved = path.resolve()
    except OSError:
        return False
    for root in APPROVED_ROOTS.values():
        try:
            resolved.relative_to(root.resolve())
            return True
        except ValueError:
            continue
    return False


def _bytes(path: Path) -> int:
    try:
        if path.is_file():
            return path.stat().st_size
        if path.is_dir():
            return sum(child.stat().st_size for child in path.rglob("*") if child.is_file())
    except OSError:
        return 0
    return 0


def _disk_snapshot() -> dict[str, int]:
    usage = shutil.disk_usage(TEMP_DIR)
    return {"total": usage.total, "used": usage.used, "free": usage.free}


async def _active_ids() -> tuple[set[str], set[str]]:
    try:
        async with aiosqlite.connect(str(DB_PATH)) as db:
            db.row_factory = aiosqlite.Row
            active_jobs = {
                row["id"]
                for row in await (
                    await db.execute(
                        """
                        SELECT id FROM jobs
                        WHERE status IN ('queued','running','processing','transcribing',
                          'aligning','normalizing','extracting_audio','romanizing',
                          'chunking','rendering','finalizing','exporting')
                        """
                    )
                ).fetchall()
            }
            active_exports = {
                row["id"]
                for row in await (
                    await db.execute(
                        "SELECT id FROM export_jobs WHERE status IN ('queued','running')"
                    )
                ).fetchall()
            }
    except aiosqlite.OperationalError:
        active_jobs = set()
        active_exports = set()
    return active_jobs, active_exports


async def _inventory() -> dict[str, object]:
    now = datetime.now(timezone.utc)
    active_jobs, active_exports = await _active_ids()
    active_identifiers = active_jobs | active_exports
    categories = {
        name: {"path": str(path), "bytes": _bytes(path), "exists": path.exists()}
        for name, path in APPROVED_ROOTS.items()
    }
    candidates: dict[str, list[dict[str, object]]] = {
        "expired_temp_audio": [],
        "expired_render_dirs": [],
        "expired_uploads": [],
        "expired_exports": [],
        "docker_application_paths": [
            {
                "path": str(path),
                "approvedRoot": _inside_approved_root(path),
                "note": "Capinsta application path only; Docker system prune is intentionally not performed.",
            }
            for path in APPROVED_ROOTS.values()
        ],
    }
    upload_cutoff = now - timedelta(hours=ABANDONED_UPLOAD_RETENTION_HOURS)
    failed_export_cutoff = now - timedelta(hours=FAILED_EXPORT_RETENTION_HOURS)
    artifact_cutoff = now - timedelta(hours=DOWNLOAD_ARTIFACT_RETENTION_HOURS)
    audio_cutoff = now - timedelta(hours=TEMP_AUDIO_RETENTION_HOURS)

    for path in UPLOAD_DIR.glob("*"):
        if path.is_file() and path.stat().st_mtime < upload_cutoff.timestamp():
            if not any(identifier in path.name for identifier in active_identifiers):
                candidates["expired_uploads"].append({"path": str(path), "bytes": _bytes(path)})

    for path in EXPORT_DIR.rglob("*"):
        if not path.is_file():
            continue
        cutoff = failed_export_cutoff if "failed" in path.name.lower() else artifact_cutoff
        if path.stat().st_mtime < cutoff.timestamp():
            if not any(identifier in path.name for identifier in active_identifiers):
                candidates["expired_exports"].append({"path": str(path), "bytes": _bytes(path)})

    for path in TEMP_DIR.rglob("*"):
        if path.is_file() and path.suffix.lower() in {".wav", ".mp3", ".m4a"}:
            if path.stat().st_mtime < audio_cutoff.timestamp():
                if not any(identifier in path.name for identifier in active_identifiers):
                    candidates["expired_temp_audio"].append({"path": str(path), "bytes": _bytes(path)})

    for path in TEMP_DIR.iterdir():
        if not path.is_dir() or not path.name.startswith(
            ("capinsta_capture_", "capinsta_sparse_", "huygen_frames_")
        ):
            continue
        if any(identifier in path.name for identifier in active_identifiers):
            continue
        if path.stat().st_mtime < failed_export_cutoff.timestamp():
            candidates["expired_render_dirs"].append({"path": str(path), "bytes": _bytes(path)})

    return {
        "activeJobs": len(active_jobs),
        "activeExports": len(active_exports),
        "storageByCategory": categories,
        "candidates": candidates,
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="delete eligible files")
    parser.add_argument("--json", action="store_true", help="emit JSON only")
    args = parser.parse_args()

    before = _disk_snapshot()
    report: dict[str, object] = {
        "mode": "apply" if args.apply else "dry-run",
        "beforeDisk": before,
        "inventory": await _inventory(),
        "deleted": None,
    }
    if args.apply:
        report["deleted"] = await cleanup_retained_storage()
        report["afterDisk"] = _disk_snapshot()
    else:
        report["afterDisk"] = before

    text = json.dumps(report, indent=2, sort_keys=True)
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
