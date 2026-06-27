"""Audit and migrate CapInsta backend disk storage into scoped paths.

Default mode is dry-run. Use --apply only after reviewing the JSON report.
The script never trusts legacy paths blindly: every candidate must have user
and project ownership metadata and the source path must remain inside the
configured storage root.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.settings import DB_PATH, EXPORT_DIR, MEDIA_DIR, UPLOAD_DIR  # noqa: E402
from server.storage_paths import path_inside, public_download_name, resolve_existing_file_inside  # noqa: E402


@dataclass
class MovePlan:
    table: str
    record_id: str
    source: str
    destination: str
    user_id: str
    project_id: str
    action: str


@dataclass
class Quarantine:
    table: str
    record_id: str
    reason: str
    source: str | None = None


def _row_dict(cursor: sqlite3.Cursor, row: sqlite3.Row) -> dict:
    return {key: row[key] for key in row.keys()}


def _connect(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(str(path))
    db.row_factory = sqlite3.Row
    return db


def _is_scoped_media_path(row: sqlite3.Row) -> bool:
    try:
        expected = path_inside(MEDIA_DIR, row["user_id"], row["project_id"], row["id"]).resolve()
        actual = Path(row["storage_path"]).resolve()
    except Exception:
        return False
    return actual == expected


def _resolve_source(root: Path, raw_path: str | None, *, label: str) -> Path | None:
    if not raw_path:
        return None
    try:
        return resolve_existing_file_inside(root, raw_path, label=label)
    except (ValueError, FileNotFoundError):
        return None


def _unique_destination(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.name
    for index in range(1, 1000):
        candidate = path.with_name(f"{stem}.{index}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Could not allocate unique destination below {path.parent}")


def build_plan(db: sqlite3.Connection) -> tuple[list[MovePlan], list[Quarantine], dict[str, int]]:
    plans: list[MovePlan] = []
    quarantined: list[Quarantine] = []
    counts = {
        "mediaAssets": 0,
        "legacyJobUploads": 0,
        "exports": 0,
        "alreadyScoped": 0,
    }

    for row in db.execute("SELECT * FROM media_assets WHERE deleted_at IS NULL"):
        counts["mediaAssets"] += 1
        if not row["user_id"] or not row["project_id"] or not row["id"]:
            quarantined.append(Quarantine("media_assets", row["id"], "missing_owner_or_project", row["storage_path"]))
            continue
        if _is_scoped_media_path(row):
            counts["alreadyScoped"] += 1
            continue
        source = _resolve_source(MEDIA_DIR, row["storage_path"], label="media asset")
        if source is None:
            quarantined.append(Quarantine("media_assets", row["id"], "source_missing_or_outside_media_root", row["storage_path"]))
            continue
        destination = path_inside(MEDIA_DIR, row["user_id"], row["project_id"], row["id"])
        plans.append(MovePlan("media_assets", row["id"], str(source), str(destination), row["user_id"], row["project_id"], "move_media_asset"))

    for row in db.execute("SELECT * FROM jobs WHERE deleted_at IS NULL AND (media_asset_id IS NULL OR media_asset_id = '')"):
        counts["legacyJobUploads"] += 1
        if not row["user_id"] or not (row["project_id"] or row["id"]):
            quarantined.append(Quarantine("jobs", row["id"], "missing_owner_or_project"))
            continue
        legacy = _resolve_source(UPLOAD_DIR, str(path_inside(UPLOAD_DIR, f"{row['id']}_{row['filename']}")), label="legacy job upload")
        if legacy is None:
            quarantined.append(Quarantine("jobs", row["id"], "legacy_upload_missing_or_outside_upload_root"))
            continue
        asset_id = str(uuid.uuid4())
        project_id = row["project_id"] or row["id"]
        destination = path_inside(MEDIA_DIR, row["user_id"], project_id, asset_id)
        plans.append(MovePlan("jobs", row["id"], str(legacy), str(destination), row["user_id"], project_id, f"create_media_asset:{asset_id}"))

    for row in db.execute("SELECT * FROM export_jobs WHERE output_path IS NOT NULL AND deleted_at IS NULL"):
        counts["exports"] += 1
        if not row["user_id"] or not (row["project_id"] or row["source_job_id"]) or not row["id"]:
            quarantined.append(Quarantine("export_jobs", row["id"], "missing_owner_or_project", row["output_path"]))
            continue
        source = _resolve_source(EXPORT_DIR, row["output_path"], label="export file")
        if source is None:
            quarantined.append(Quarantine("export_jobs", row["id"], "source_missing_or_outside_export_root", row["output_path"]))
            continue
        project_id = row["project_id"] or row["source_job_id"]
        expected_parent = path_inside(EXPORT_DIR, row["user_id"], project_id, row["id"])
        if source.parent.resolve() == expected_parent.resolve():
            counts["alreadyScoped"] += 1
            continue
        destination = expected_parent / public_download_name(row["filename"] or source.name, fallback="capinsta-export.mp4")
        plans.append(MovePlan("export_jobs", row["id"], str(source), str(destination), row["user_id"], project_id, "move_export"))

    return plans, quarantined, counts


def apply_plan(db: sqlite3.Connection, plans: list[MovePlan], rollback_path: Path) -> list[dict]:
    rollback: list[dict] = []
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS disk_storage_quarantine (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            record_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            source_path TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    try:
        db.execute("BEGIN IMMEDIATE")
        for plan in plans:
            source = Path(plan.source)
            destination = _unique_destination(Path(plan.destination))
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(source, destination)
            rollback.append({**asdict(plan), "destination": str(destination)})
            if plan.table == "media_assets":
                db.execute(
                    "UPDATE media_assets SET storage_path = ? WHERE id = ? AND user_id = ?",
                    (str(destination), plan.record_id, plan.user_id),
                )
            elif plan.table == "jobs":
                asset_id = plan.action.split(":", 1)[1]
                db.execute(
                    """
                    INSERT INTO media_assets (
                        id, project_id, user_id, original_name, mime_type, size_bytes,
                        storage_path, status, created_at, last_accessed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
                    """,
                    (
                        asset_id,
                        plan.project_id,
                        plan.user_id,
                        Path(destination).name,
                        "video/mp4",
                        destination.stat().st_size,
                        str(destination),
                        now,
                        now,
                    ),
                )
                db.execute(
                    "UPDATE jobs SET media_asset_id = ?, project_id = COALESCE(project_id, id) WHERE id = ? AND user_id = ?",
                    (asset_id, plan.record_id, plan.user_id),
                )
            elif plan.table == "export_jobs":
                db.execute(
                    "UPDATE export_jobs SET output_path = ?, download_url = ? WHERE id = ? AND user_id = ?",
                    (str(destination), f"/api/export/jobs/{plan.record_id}/download", plan.record_id, plan.user_id),
                )
        rollback_path.parent.mkdir(parents=True, exist_ok=True)
        rollback_path.write_text(json.dumps(rollback, indent=2), encoding="utf-8")
        db.commit()
    except Exception:
        db.rollback()
        for item in reversed(rollback):
            try:
                os.replace(item["destination"], item["source"])
            except OSError:
                pass
        raise
    return rollback


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DB_PATH)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rollback-map", type=Path, default=Path("disk-storage-migration-rollback.json"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    with _connect(args.db) as db:
        plans, quarantined, counts = build_plan(db)
        report = {
            "dryRun": not args.apply,
            "counts": counts,
            "plannedMoves": [asdict(plan) for plan in plans],
            "quarantined": [asdict(item) for item in quarantined],
            "rollbackMap": str(args.rollback_map) if args.apply else None,
        }
        if args.apply:
            report["appliedMoves"] = apply_plan(db, plans, args.rollback_map)

    text = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    print(text)
    return 1 if quarantined and not args.apply else 0


if __name__ == "__main__":
    raise SystemExit(main())
