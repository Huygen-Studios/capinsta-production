import os
import logging
import shutil
import tempfile
import time
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
logger = logging.getLogger(__name__)


def _default_temp_dir() -> Path:
    if os.name == "nt":
        return Path(tempfile.gettempdir()) / "huygen-caps"
    return Path("/tmp/huygen-caps")


DEFAULT_TEMP_DIR = _default_temp_dir()


def _path_env(name: str, default: Path) -> Path:
    value = os.getenv(name, "").strip()
    return Path(value).expanduser() if value else default


def _sqlite_path_env(name: str, default: Path) -> Path:
    path = _path_env(name, default)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a+b"):
            pass
        probe = path.parent / ".capinsta-sqlite-write-check"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return path
    except OSError as exc:
        if os.getenv("NODE_ENV") == "production":
            raise RuntimeError(
                f"{name} parent is not writable; check legacy caption storage volume"
            ) from exc
        fallback = DEFAULT_TEMP_DIR / "database.sqlite"
        fallback.parent.mkdir(parents=True, exist_ok=True)
        logger.warning(
            "sqlite_db_path_not_writable configured=%s fallback=%s error=%s",
            path,
            fallback,
            exc,
        )
        return fallback


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


TEMP_DIR = _path_env("TEMP_DIR", DEFAULT_TEMP_DIR)
UPLOAD_DIR = _path_env("UPLOAD_DIR", TEMP_DIR / "uploads")
EXPORT_DIR = _path_env("EXPORT_DIR", TEMP_DIR / "exports")
CACHE_DIR = _path_env("CACHE_DIR", TEMP_DIR / "cache")
MEDIA_DIR = _path_env("MEDIA_DIR", TEMP_DIR / "media")
DB_PATH = _sqlite_path_env("DB_PATH", TEMP_DIR / "database.sqlite")
FRONTEND_DIST_DIR = _path_env("FRONTEND_DIST_DIR", ROOT_DIR / "frontend" / "out")
_bundled_caption_font_dir = FRONTEND_DIST_DIR / "caption-fonts"
_development_caption_font_dir = ROOT_DIR.parent / "apps" / "web" / "public" / "caption-fonts"
CAPTION_FONT_DIR = _path_env(
    "CAPTION_FONT_DIR",
    _bundled_caption_font_dir
    if _bundled_caption_font_dir.exists()
    else _development_caption_font_dir,
)

MAX_UPLOAD_SIZE_MB = _int_env("MAX_UPLOAD_SIZE_MB", 500)
CAPTION_DURATION_LIMIT_SECONDS = max(
    1, _int_env("CAPTION_DURATION_LIMIT_SECONDS", 180)
)
MAX_JSON_BODY_BYTES = max(1024, _int_env("MAX_JSON_BODY_BYTES", 1 * 1024 * 1024))
MAX_FORM_BODY_BYTES = max(1024, _int_env("MAX_FORM_BODY_BYTES", 8 * 1024 * 1024))
RUNTIME_CLEANUP_HOURS = _int_env("RUNTIME_CLEANUP_HOURS", 24)
ABANDONED_UPLOAD_RETENTION_HOURS = max(
    1, _int_env("ABANDONED_UPLOAD_RETENTION_HOURS", 24)
)
FAILED_EXPORT_RETENTION_HOURS = max(
    1, _int_env("FAILED_EXPORT_RETENTION_HOURS", 6)
)
DOWNLOAD_ARTIFACT_RETENTION_HOURS = max(
    1, _int_env("DOWNLOAD_ARTIFACT_RETENTION_HOURS", 24)
)
TEMP_AUDIO_RETENTION_HOURS = max(1, _int_env("TEMP_AUDIO_RETENTION_HOURS", 6))
ORPHAN_SCAN_INTERVAL_SECONDS = max(
    300, _int_env("ORPHAN_SCAN_INTERVAL_SECONDS", 86400)
)
DISK_WARNING_FREE_BYTES = max(
    0, _int_env("DISK_WARNING_FREE_BYTES", 8 * 1024 * 1024 * 1024)
)
DISK_REJECT_UPLOAD_FREE_BYTES = max(
    0, _int_env("DISK_REJECT_UPLOAD_FREE_BYTES", 5 * 1024 * 1024 * 1024)
)
DISK_CRITICAL_FREE_BYTES = max(
    0, _int_env("DISK_CRITICAL_FREE_BYTES", 2 * 1024 * 1024 * 1024)
)
PROJECT_INACTIVITY_TTL_MINUTES = max(1, _int_env("PROJECT_INACTIVITY_TTL_MINUTES", 15))
PROJECT_CLEANUP_INTERVAL_SECONDS = max(1, _int_env("PROJECT_CLEANUP_INTERVAL_SECONDS", 60))
PROJECT_MAX_LIFETIME_MINUTES = max(
    PROJECT_INACTIVITY_TTL_MINUTES,
    _int_env("PROJECT_MAX_LIFETIME_MINUTES", 90),
)
MAX_CONCURRENT_EXPORTS = max(1, _int_env("MAX_CONCURRENT_EXPORTS", 1))
MAX_EXPORT_DURATION_SECONDS = max(1, _int_env("MAX_EXPORT_DURATION_SECONDS", 300))


def env_list(name: str, fallback: list[str]) -> list[str]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return fallback
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


def ensure_runtime_dirs() -> None:
    for path in (
        TEMP_DIR,
        UPLOAD_DIR,
        EXPORT_DIR,
        CACHE_DIR,
        MEDIA_DIR,
        DB_PATH.parent,
    ):
        path.mkdir(parents=True, exist_ok=True)


def validate_storage_startup() -> list[dict[str, str]]:
    """Best-effort production storage diagnostics.

    The check is intentionally non-destructive and only warns for filesystem
    mismatch because direct MEDIA_DIR consumption makes cross-device hardlinks
    unnecessary for server-backed uploads.
    """
    ensure_runtime_dirs()
    findings: list[dict[str, str]] = []
    named_paths = {
        "TEMP_DIR": TEMP_DIR,
        "UPLOAD_DIR": UPLOAD_DIR,
        "EXPORT_DIR": EXPORT_DIR,
        "CACHE_DIR": CACHE_DIR,
        "MEDIA_DIR": MEDIA_DIR,
        "DB_PATH_PARENT": DB_PATH.parent,
    }
    for name, path in named_paths.items():
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path
        if resolved == resolved.anchor:
            findings.append(
                {"level": "error", "code": "unsafe_storage_root", "path": name}
            )
        if not path.exists():
            findings.append({"level": "error", "code": "missing_directory", "path": name})
            continue
        if not path.is_dir():
            findings.append({"level": "error", "code": "not_directory", "path": name})
            continue
        probe = path / ".capinsta-write-check"
        try:
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
        except OSError:
            findings.append({"level": "error", "code": "not_writable", "path": name})
    try:
        media_device = os.stat(MEDIA_DIR).st_dev
        upload_device = os.stat(UPLOAD_DIR).st_dev
        if media_device != upload_device:
            findings.append(
                {
                    "level": "warning",
                    "code": "media_upload_filesystem_mismatch",
                    "path": "MEDIA_DIR,UPLOAD_DIR",
                }
            )
    except OSError:
        pass
    if not (
        DISK_WARNING_FREE_BYTES >= DISK_REJECT_UPLOAD_FREE_BYTES >= DISK_CRITICAL_FREE_BYTES
    ):
        findings.append(
            {
                "level": "error",
                "code": "invalid_disk_threshold_ordering",
                "path": "DISK_*_FREE_BYTES",
            }
        )
    for finding in findings:
        log = logger.error if finding["level"] == "error" else logger.warning
        log(
            "storage_startup_check level=%s code=%s target=%s",
            finding["level"],
            finding["code"],
            finding["path"],
        )
    if not findings:
        logger.info("storage_startup_check status=ok")
    return findings


def cleanup_old_runtime_files(max_age_hours: int | None = None) -> int:
    """Best-effort cleanup for Render's ephemeral disk and local temp files."""
    max_age = (max_age_hours if max_age_hours is not None else RUNTIME_CLEANUP_HOURS) * 3600
    if max_age <= 0:
        return 0

    cutoff = time.time() - max_age
    removed = 0
    for directory in (UPLOAD_DIR, EXPORT_DIR):
        if not directory.exists():
            continue
        for path in directory.iterdir():
            try:
                if path.stat().st_mtime >= cutoff:
                    continue
                if path.is_file():
                    path.unlink()
                    removed += 1
                elif path.is_dir():
                    shutil.rmtree(path)
                    removed += 1
            except OSError:
                continue
    return removed


def frontend_dist_available() -> bool:
    # The backend image bundles only the dedicated headless renderer and its
    # matching Next.js static chunks, not the public frontend application.
    return (FRONTEND_DIST_DIR / "render.html").exists()


def bundled_render_page_url() -> str:
    port = os.getenv("PORT", "8000")
    return f"http://127.0.0.1:{port}/render.html"


def default_render_page_url() -> str:
    render_base_url = os.getenv("CAPINSTA_RENDER_BASE_URL", "").split(",", 1)[0].strip().rstrip("/")
    if render_base_url:
        return f"{render_base_url}/render"

    configured = os.getenv("RENDER_PAGE_URL", "").strip()
    if configured:
        return configured

    if frontend_dist_available():
        return bundled_render_page_url()

    frontend_url = os.getenv("FRONTEND_URL", "").split(",", 1)[0].strip().rstrip("/")
    if frontend_url:
        return f"{frontend_url}/render"

    return "http://localhost:3000/render"


def dependency_status() -> dict[str, bool | str]:
    return {
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ffprobe": bool(shutil.which("ffprobe")),
        "storageWritable": TEMP_DIR.exists() and os.access(TEMP_DIR, os.W_OK),
        "uploadsWritable": UPLOAD_DIR.exists() and os.access(UPLOAD_DIR, os.W_OK),
        "exportsWritable": EXPORT_DIR.exists() and os.access(EXPORT_DIR, os.W_OK),
        "frontend_static": frontend_dist_available(),
    }
