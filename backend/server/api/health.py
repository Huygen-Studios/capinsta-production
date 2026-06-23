import hashlib
import json
from datetime import datetime, timezone
from fastapi import APIRouter
from pydantic import BaseModel, Field
import os
import sqlite3
from pathlib import Path

from ..settings import (
    CACHE_DIR,
    DB_PATH,
    EXPORT_DIR,
    FRONTEND_DIST_DIR,
    MAX_UPLOAD_SIZE_MB,
    MEDIA_DIR,
    TEMP_DIR,
    UPLOAD_DIR,
    default_render_page_url,
    dependency_status,
)
from ..headless_export import check_export_runtime, check_export_runtime_async
from ..worker_startup import check_pipeline_worker_import
from ai_pipeline.transcriber import is_real_secret
from .export_jobs import export_job_metrics
from ..auth import auth_health_status
from ..runtime_policy import control_plane_health
from ..storage_pressure import read_disk_pressure

router = APIRouter(prefix="/health", tags=["health"])

class HealthResponse(BaseModel):
    status: str
    service: str = "huygen-caps-backend"
    environment: str = "development"
    version: str
    stt_provider: str | None = None
    provider_keys: dict[str, bool] = Field(default_factory=dict)
    dependencies: dict[str, bool | str] = Field(default_factory=dict)
    max_upload_mb: int
    render_page_url: str
    render_artifact: dict[str, object] | None = None
    storage: dict[str, object] = Field(default_factory=dict)
    message: str | None = None
    supabaseAuth: str = "unknown"
    controlPlaneDatabase: str = "unknown"
    jwtMode: str = "unknown"

def _has_key(name: str) -> bool:
    return is_real_secret(os.getenv(name))


def _tree_bytes(
    root: Path, seen_files: set[tuple[int, int]] | None = None
) -> int:
    total = 0
    if not root.exists():
        return 0
    for path in root.rglob("*"):
        if path.is_file():
            try:
                stat = path.stat()
                file_id = (stat.st_dev, stat.st_ino)
                if seen_files is not None and file_id in seen_files:
                    continue
                if seen_files is not None:
                    seen_files.add(file_id)
                total += stat.st_size
            except OSError:
                continue
    return total


def _orphaned_bytes() -> int:
    known_media: set[str] = set()
    known_exports: set[str] = set()
    known_upload_prefixes: set[str] = set()
    try:
        with sqlite3.connect(str(DB_PATH)) as db:
            known_media = {
                str(Path(row[0]).resolve())
                for row in db.execute(
                    "SELECT storage_path FROM media_assets WHERE deleted_at IS NULL"
                )
            }
            known_exports = {
                str(Path(row[0]).resolve())
                for row in db.execute(
                    "SELECT output_path FROM export_jobs WHERE output_path IS NOT NULL"
                )
            }
            known_upload_prefixes = {
                f"{row[0]}_" for row in db.execute("SELECT id FROM jobs")
            }
    except (OSError, sqlite3.Error):
        return 0
    total = 0
    for root, known in ((MEDIA_DIR, known_media), (EXPORT_DIR, known_exports)):
        for path in root.rglob("*"):
            try:
                if path.is_file() and str(path.resolve()) not in known:
                    total += path.stat().st_size
            except OSError:
                continue
    for path in UPLOAD_DIR.glob("*"):
        try:
            if path.is_file() and not any(
                path.name.startswith(prefix) for prefix in known_upload_prefixes
            ):
                total += path.stat().st_size
        except OSError:
            continue
    return total


def storage_summary() -> dict[str, object]:
    pressure = read_disk_pressure()
    logs_dir = TEMP_DIR / "logs"
    seen_files: set[tuple[int, int]] = set()
    media_bytes = _tree_bytes(MEDIA_DIR, seen_files)
    upload_bytes = _tree_bytes(UPLOAD_DIR, seen_files)
    audio_bytes = 0
    render_bytes = 0
    for path in TEMP_DIR.rglob("*"):
        try:
            if path.is_file() and path.suffix.lower() in {".wav", ".mp3", ".m4a"}:
                audio_bytes += path.stat().st_size
        except OSError:
            continue
    for prefix in ("capinsta_capture_*", "capinsta_sparse_*", "huygen_frames_*"):
        render_bytes += sum(
            _tree_bytes(path)
            for path in TEMP_DIR.glob(prefix)
            if path.is_dir()
        )
    return {
        "uploadsBytes": upload_bytes,
        "mediaAssetsBytes": media_bytes,
        "extractedAudioBytes": audio_bytes,
        "proxiesBytes": 0,
        "thumbnailsWaveformsBytes": _tree_bytes(CACHE_DIR),
        "temporaryRenderBytes": render_bytes,
        "exportsBytes": _tree_bytes(EXPORT_DIR),
        "logsBytes": _tree_bytes(logs_dir),
        "orphanedBytes": _orphaned_bytes(),
        "diskTotalBytes": pressure.total_bytes,
        "diskUsedBytes": pressure.used_bytes,
        "diskFreeBytes": pressure.free_bytes,
        "diskPressure": pressure.level,
    }


def _render_artifact_metadata() -> dict[str, object] | None:
    artifact_path = FRONTEND_DIST_DIR / "render.html"
    manifest_path = FRONTEND_DIST_DIR / "render-artifact.json"
    if not artifact_path.exists():
        return None

    metadata: dict[str, object] = {}
    if manifest_path.exists():
        try:
            parsed = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                metadata.update(parsed)
        except (OSError, json.JSONDecodeError):
            pass

    artifact_bytes = artifact_path.read_bytes()
    artifact_stat = artifact_path.stat()
    actual_sha256 = hashlib.sha256(artifact_bytes).hexdigest()
    metadata.update({
        "containerPath": str(artifact_path),
        "modifiedTimeUtc": datetime.fromtimestamp(
            artifact_stat.st_mtime,
            tz=timezone.utc,
        ).isoformat(),
        "sha256": actual_sha256,
        "manifestChecksumMatches": metadata.get("sha256", actual_sha256) == actual_sha256,
    })
    return metadata


async def health_payload() -> HealthResponse:
    deps = dependency_status()
    worker_import = check_pipeline_worker_import()
    deps["captionWorkerImport"] = bool(worker_import.get("ok"))
    if not worker_import.get("ok"):
        deps["captionWorkerImportError"] = str(worker_import.get("error"))
    warnings: list[str] = []
    provider = os.getenv("STT_PROVIDER", "auto").strip() or "auto"
    if not deps.get("ffmpeg"):
        warnings.append("FFmpeg is not available; MP4 export will fail.")
    if not deps.get("ffprobe"):
        warnings.append("FFprobe is not available; duration detection may fail.")
    if not worker_import.get("ok"):
        warnings.append(str(worker_import.get("error")))

    auth_status = auth_health_status()
    database_status = await control_plane_health()
    overall_status = (
        "ok"
        if auth_status["supabaseAuth"] == "healthy"
        and database_status["controlPlaneDatabase"] == "healthy"
        else "degraded"
    )
    return HealthResponse(
        status=overall_status,
        environment=os.getenv("NODE_ENV", "development"),
        version="5.0.0",
        stt_provider=provider,
        provider_keys={
            "gemini": _has_key("GEMINI_API_KEY") or _has_key("GOOGLE_API_KEY"),
            "groq": _has_key("GROQ_API_KEY"),
            "openai": _has_key("OPENAI_API_KEY"),
            "sarvam": _has_key("SARVAM_API_KEY"),
        },
        dependencies=deps,
        max_upload_mb=MAX_UPLOAD_SIZE_MB,
        render_page_url=default_render_page_url(),
        render_artifact=_render_artifact_metadata(),
        storage=storage_summary(),
        message=" ".join(warnings) if warnings else None,
        **auth_status,
        **database_status,
    )


def _dir_writable(path: Path) -> tuple[bool, str | None]:
    probe = path / ".health_write_probe"
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe.write_text("ok", encoding="utf-8")
        return True, None
    except OSError as exc:
        return False, str(exc)
    finally:
        try:
            probe.unlink(missing_ok=True)
        except OSError:
            pass


def export_health_payload() -> dict[str, object]:
    """Focused diagnostics for MP4 export on local dev and Render."""
    payload = check_export_runtime()
    temp_writable, temp_error = _dir_writable(TEMP_DIR)
    export_writable, export_error = _dir_writable(EXPORT_DIR)
    renderer_available = bool(payload.get("playwright_package"))

    payload.update({
        "ffmpegAvailable": bool(payload.get("ffmpeg")),
        "ffprobeAvailable": bool(payload.get("ffprobe")),
        "tempDirWritable": temp_writable,
        "tempDirWriteError": temp_error,
        "exportDirWritable": export_writable,
        "exportDirWriteError": export_error,
        "rendererAvailable": renderer_available,
        "tempDir": str(TEMP_DIR),
        "exportDir": str(EXPORT_DIR),
        **export_job_metrics(),
    })
    if not (payload["ffmpegAvailable"] and payload["ffprobeAvailable"] and temp_writable and export_writable and renderer_available):
        payload["status"] = "degraded"
    return payload


def timing_health_payload() -> dict[str, object]:
    from ai_pipeline.timing import alignment_provider_status

    payload = alignment_provider_status()
    worker_import = check_pipeline_worker_import()
    payload["captionWorkerImport"] = bool(worker_import.get("ok"))
    payload["captionWorkerImportError"] = worker_import.get("error")
    payload["status"] = "ok" if payload["ffmpegAvailable"] and payload["ffprobeAvailable"] and worker_import.get("ok") else "degraded"
    payload["pauseSplitThreshold"] = float(os.getenv("PAUSE_SPLIT_THRESHOLD", "0.30") or 0.30)
    payload["defaultGlobalCaptionOffset"] = float(os.getenv("DEFAULT_GLOBAL_CAPTION_OFFSET", "0") or 0)
    return payload


async def export_health_payload_async() -> dict[str, object]:
    payload = await check_export_runtime_async()
    temp_writable, temp_error = _dir_writable(TEMP_DIR)
    export_writable, export_error = _dir_writable(EXPORT_DIR)
    renderer_available = bool(payload.get("playwright_package") and payload.get("chromium_launch"))

    payload.update({
        "ffmpegAvailable": bool(payload.get("ffmpeg")),
        "ffprobeAvailable": bool(payload.get("ffprobe")),
        "tempDirWritable": temp_writable,
        "tempDirWriteError": temp_error,
        "exportDirWritable": export_writable,
        "exportDirWriteError": export_error,
        "rendererAvailable": renderer_available,
        "tempDir": str(TEMP_DIR),
        "exportDir": str(EXPORT_DIR),
        **export_job_metrics(),
    })
    if not (payload["ffmpegAvailable"] and payload["ffprobeAvailable"] and temp_writable and export_writable and renderer_available):
        payload["status"] = "degraded"
    return payload


@router.get("", response_model=HealthResponse)
@router.get("/", response_model=HealthResponse)
async def health_check():
    """Runtime health check for Render and the editor connectivity probe."""
    return await health_payload()


@router.get("/export")
async def export_health_check():
    return await export_health_payload_async()


@router.get("/timing")
async def timing_health_check():
    return timing_health_payload()
