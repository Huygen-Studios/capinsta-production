import os
import shutil
import tempfile
import time
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]


def _default_temp_dir() -> Path:
    if os.name == "nt":
        return Path(tempfile.gettempdir()) / "huygen-caps"
    return Path("/tmp/huygen-caps")


DEFAULT_TEMP_DIR = _default_temp_dir()


def _path_env(name: str, default: Path) -> Path:
    value = os.getenv(name, "").strip()
    return Path(value).expanduser() if value else default


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
DB_PATH = _path_env("DB_PATH", TEMP_DIR / "database.sqlite")
FRONTEND_DIST_DIR = _path_env("FRONTEND_DIST_DIR", ROOT_DIR / "frontend" / "out")
CAPTION_FONT_DIR = _path_env("CAPTION_FONT_DIR", ROOT_DIR / "fonts")

MAX_UPLOAD_SIZE_MB = _int_env("MAX_UPLOAD_SIZE_MB", 500)
RUNTIME_CLEANUP_HOURS = _int_env("RUNTIME_CLEANUP_HOURS", 24)
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
    for path in (TEMP_DIR, UPLOAD_DIR, EXPORT_DIR, CACHE_DIR, DB_PATH.parent):
        path.mkdir(parents=True, exist_ok=True)


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
    configured = os.getenv("RENDER_PAGE_URL", "").strip()
    if configured:
        return configured

    if frontend_dist_available() or os.getenv("NODE_ENV") == "production":
        return bundled_render_page_url()

    return "http://localhost:3000/render"


def dependency_status() -> dict[str, bool | str]:
    return {
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ffprobe": bool(shutil.which("ffprobe")),
        "storage": str(TEMP_DIR),
        "uploads": str(UPLOAD_DIR),
        "exports": str(EXPORT_DIR),
        "frontend_static": frontend_dist_available(),
    }
