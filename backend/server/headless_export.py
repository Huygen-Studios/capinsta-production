"""
Headless Browser Export — Pixel-perfect caption rendering via Playwright + FFmpeg.

Captures each caption frame as a transparent PNG from the Next.js /render page,
then composites onto the original video using FFmpeg overlay filter.
"""

import os
import json
import asyncio
import base64
import hashlib
import hmac
import logging
import math
import re
import struct
import shutil
import time
import tempfile
import subprocess
from functools import lru_cache
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Awaitable, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .asyncio_compat import needs_proactor_thread, run_on_proactor_loop
from .settings import (
    EXPORT_DIR,
    TEMP_DIR,
    bundled_render_page_url,
    default_render_page_url,
    ensure_runtime_dirs,
    frontend_dist_available,
)
from .render_engine import (
    RenderEngine,
    build_sparse_caption_render_plan,
    select_render_engine,
)

logger = logging.getLogger(__name__)

# Resolution presets
RESOLUTION_MAP = {
    "1080p": (1920, 1080),
    "720p": (1280, 720),
    "480p": (854, 480),
}
QUALITY_CRF = {
    "fast": "28",
    "draft": "28",
    "standard": "23",
    "high": "18",
    "best": "16",
    "balanced": "23",
    "low_bitrate": "30",
    "custom": "20",
}
BITRATE_PRESETS = {
    "low": "3M",
    "medium": "8M",
    "high": "16M",
}

EXPORT_FPS = 30
RENDER_TOKEN_AUDIENCE = "capinsta.render"
RENDER_TOKEN_TTL_SECONDS = 5 * 60


@asynccontextmanager
async def _playwright_session(async_playwright_factory):
    """Own Playwright without letting a dead driver transport escape cleanup."""
    playwright = await async_playwright_factory().start()
    try:
        yield playwright
    finally:
        try:
            await playwright.stop()
        except Exception as exc:
            logger.warning(
                "playwright_cleanup_ignored transport_already_closed=%s raw_error=%r",
                _looks_like_browser_disconnect(exc),
                exc,
            )


def _peak_process_memory_mb() -> float | None:
    """Best-effort peak RSS without adding a runtime dependency."""
    try:
        import resource

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return peak / 1024 if os.name != "nt" else peak / (1024 * 1024)
    except Exception:
        return None


@dataclass
class ExportPerformanceMetrics:
    export_job_id: str
    mode: str
    duration_seconds: float
    fps: int
    total_frames: int
    queue_wait_seconds: float = 0.0
    worker_execution_seconds: float = 0.0
    browser_launch_seconds: float = 0.0
    render_page_load_seconds: float = 0.0
    caption_injection_seconds: float = 0.0
    font_readiness_seconds: float = 0.0
    first_frame_readiness_seconds: float = 0.0
    frame_advance_seconds: float = 0.0
    screenshot_seconds: float = 0.0
    ffmpeg_drain_seconds: float = 0.0
    ffmpeg_finalize_seconds: float = 0.0
    captions_only_png_disk_write_seconds: float = 0.0
    captions_only_ffmpeg_encode_seconds: float = 0.0
    renderer_restarts: int = 0
    browser_recoveries: int = 0
    renderer_restart_seconds: float = 0.0
    screenshots: int = 0
    ffmpeg_drains: int = 0
    png_bytes_total: int = 0
    png_bytes_max: int = 0
    screenshot_seconds_max: float = 0.0
    sparse_plan_seconds: float = 0.0
    sparse_capture_seconds: float = 0.0
    sparse_encode_seconds: float = 0.0
    legacy_frames: int = 0
    captured_frames: int = 0
    render_engine: str = "browser_full_frame"
    peak_process_memory_mb: float | None = None

    def record_screenshot(self, elapsed: float, byte_count: int) -> None:
        self.screenshots += 1
        self.captured_frames += 1
        self.screenshot_seconds += elapsed
        self.screenshot_seconds_max = max(self.screenshot_seconds_max, elapsed)
        self.png_bytes_total += byte_count
        self.png_bytes_max = max(self.png_bytes_max, byte_count)

    def record_ffmpeg_drain(self, elapsed: float) -> None:
        self.ffmpeg_drains += 1
        self.ffmpeg_drain_seconds += elapsed

    def to_summary(self, total_elapsed_seconds: float) -> dict[str, object]:
        screenshot_count = max(1, self.screenshots)
        drain_count = max(1, self.ffmpeg_drains)
        legacy_frames = self.legacy_frames or self.total_frames
        reduction = 0.0 if legacy_frames <= 0 else (1 - self.captured_frames / legacy_frames) * 100
        return {
            "event": "export_performance_summary",
            "exportJobId": self.export_job_id,
            "mode": self.mode,
            "renderEngine": self.render_engine,
            "durationSeconds": round(self.duration_seconds, 6),
            "fps": self.fps,
            "totalFrames": self.total_frames,
            "timeline_frames": self.total_frames,
            "legacyFrames": legacy_frames,
            "capturedFrames": self.captured_frames,
            "unique_captured_frames": self.captured_frames,
            "reused_frames": max(0, self.total_frames - self.captured_frames),
            "frameReductionPercent": round(max(0.0, reduction), 3),
            "capture_reduction_percent": round(max(0.0, reduction), 3),
            "queueWaitSeconds": round(self.queue_wait_seconds, 6),
            "workerExecutionSeconds": round(self.worker_execution_seconds, 6),
            "browserLaunchSeconds": round(self.browser_launch_seconds, 6),
            "renderPageLoadSeconds": round(self.render_page_load_seconds, 6),
            "captionInjectionSeconds": round(self.caption_injection_seconds, 6),
            "fontReadinessSeconds": round(self.font_readiness_seconds, 6),
            "firstFrameReadinessSeconds": round(self.first_frame_readiness_seconds, 6),
            "frameAdvanceSeconds": round(self.frame_advance_seconds, 6),
            "screenshotSeconds": round(self.screenshot_seconds, 6),
            "averageScreenshotMs": round(self.screenshot_seconds * 1000 / screenshot_count, 3),
            "maximumScreenshotMs": round(self.screenshot_seconds_max * 1000, 3),
            "ffmpegDrainSeconds": round(self.ffmpeg_drain_seconds, 6),
            "averageFfmpegDrainMs": round(self.ffmpeg_drain_seconds * 1000 / drain_count, 3),
            "ffmpegFinalizeSeconds": round(self.ffmpeg_finalize_seconds, 6),
            "captionsOnlyPngDiskWriteSeconds": round(self.captions_only_png_disk_write_seconds, 6),
            "captionsOnlyFfmpegEncodeSeconds": round(self.captions_only_ffmpeg_encode_seconds, 6),
            "rendererRestarts": self.renderer_restarts,
            "browser_recoveries": self.browser_recoveries,
            "rendererRestartSeconds": round(self.renderer_restart_seconds, 6),
            "averagePngBytes": round(self.png_bytes_total / screenshot_count, 1),
            "maximumPngBytes": self.png_bytes_max,
            "sparsePlanSeconds": round(self.sparse_plan_seconds, 6),
            "sparseCaptureSeconds": round(self.sparse_capture_seconds, 6),
            "sparseEncodeSeconds": round(self.sparse_encode_seconds, 6),
            "encodingSeconds": round(
                self.ffmpeg_drain_seconds
                + self.ffmpeg_finalize_seconds
                + self.captions_only_ffmpeg_encode_seconds
                + self.sparse_encode_seconds,
                6,
            ),
            "renderingSeconds": round(
                self.frame_advance_seconds
                + self.screenshot_seconds
                + self.renderer_restart_seconds,
                6,
            ),
            "totalElapsedSeconds": round(total_elapsed_seconds, 6),
            "capture_seconds": round(
                self.sparse_capture_seconds
                if self.render_engine == RenderEngine.BROWSER_SPARSE.value
                else self.frame_advance_seconds + self.screenshot_seconds,
                6,
            ),
            "encode_seconds": round(
                self.ffmpeg_drain_seconds
                + self.ffmpeg_finalize_seconds
                + self.captions_only_ffmpeg_encode_seconds
                + self.sparse_encode_seconds,
                6,
            ),
            "total_seconds": round(total_elapsed_seconds, 6),
            "peakProcessMemoryMb": self.peak_process_memory_mb,
        }


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def resolve_ffmpeg_threads(raw_value: str | None = None, cpu_count: int | None = None) -> int:
    """Keep x264 bounded so Chromium has memory and CPU headroom."""
    configured = (raw_value if raw_value is not None else os.getenv("EXPORT_FFMPEG_THREADS", "auto")).strip().lower()
    detected = max(1, cpu_count if cpu_count is not None else (os.cpu_count() or 2))
    automatic = max(1, min(2, detected))
    if configured in {"", "auto", "0"}:
        return automatic
    try:
        return max(1, min(automatic, int(configured)))
    except ValueError:
        return automatic


@lru_cache(maxsize=1)
def h264_nvenc_capability_available() -> bool:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    try:
        result = subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=16x16:d=0.04",
                "-frames:v",
                "1",
                "-c:v",
                "h264_nvenc",
                "-f",
                "null",
                "-",
            ],
            check=False,
            capture_output=True,
            timeout=10,
        )
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def resolve_ffmpeg_preset(hardware_acceleration: bool, *, fastest: bool) -> str:
    """Return a preset name valid for the selected H.264 encoder."""
    if hardware_acceleration:
        return "p1" if fastest else "p3"
    return "ultrafast" if fastest else "veryfast"


def _render_safe_default() -> bool:
    return bool(os.getenv("RENDER") or os.getenv("RENDER_EXTERNAL_URL"))


def _looks_like_browser_disconnect(exc: BaseException) -> bool:
    """Classify only Playwright/browser lifecycle failures as recoverable."""
    current: BaseException | None = exc
    messages: list[str] = []
    while current is not None and len(messages) < 6:
        messages.append(f"{type(current).__name__}: {current}".lower())
        current = current.__cause__ or current.__context__
    text = " | ".join(messages)
    return any(
        marker in text
        for marker in (
            "writeunixtransport",
            "handler is closed",
            "targetclosederror",
            "target closed",
            "browser closed",
            "browser has been closed",
            "page closed",
            "page has been closed",
            "connection closed",
            "connection lost",
            "playwright._impl",
            "browser disconnected",
            "browser has disconnected",
            "renderer process crashed",
            "page crashed",
        )
    )


def _should_schedule_page_recycle(frame_index: int, recycle_frames: int) -> bool:
    return recycle_frames > 0 and frame_index > 0 and frame_index % recycle_frames == 0


def _should_recreate_captions_chunk(attempt: int) -> bool:
    return attempt > 0


def _should_run_clean_check(frame_index: int, interval_frames: int) -> bool:
    return interval_frames > 0 and frame_index > 0 and frame_index % interval_frames == 0


def _capture_chunks(total_captures: int, chunk_size: int) -> list[tuple[int, int]]:
    size = max(1, chunk_size)
    return [
        (start, min(total_captures, start + size))
        for start in range(0, total_captures, size)
    ]


def _capture_progress(completed: int, total: int) -> int:
    return 5 + int((max(0, min(completed, total)) / max(1, total)) * 75)


def _build_ffconcat_manifest(
    frame_paths: list[Path],
    duration_frames: list[int],
    fps: int,
) -> str:
    if not frame_paths or len(frame_paths) != len(duration_frames):
        raise ValueError("Sparse concat manifest requires matching frames and durations.")
    lines = ["ffconcat version 1.0"]
    for frame_path, frames in zip(frame_paths, duration_frames):
        normalized = frame_path.resolve().as_posix().replace("'", "'\\''")
        lines.append(f"file '{normalized}'")
        lines.append(f"duration {frames / fps:.9f}")
    final_path = frame_paths[-1].resolve().as_posix().replace("'", "'\\''")
    lines.append(f"file '{final_path}'")
    return "\n".join(lines) + "\n"


def _discard_capture_range(
    frame_paths: list[Path],
    start: int,
    end: int,
) -> None:
    for index in range(start, end):
        frame_paths[index].unlink(missing_ok=True)
        frame_paths[index].with_suffix(".png.part").unlink(missing_ok=True)


def _assert_ffmpeg_output_options_after_inputs(command: list[str]) -> None:
    input_positions = [index for index, value in enumerate(command) if value == "-i"]
    if not input_positions:
        raise ValueError("FFmpeg command has no inputs.")
    last_input = input_positions[-1]
    output_only_options = {
        "-c:v",
        "-codec:v",
        "-preset",
        "-crf",
        "-cq",
        "-b:v",
        "-threads",
        "-pix_fmt",
        "-movflags",
        "-c:a",
    }
    misplaced = [
        option
        for option in output_only_options
        if option in command and command.index(option) < last_input
    ]
    if misplaced:
        raise ValueError(
            "FFmpeg output options precede the final input: "
            + ", ".join(sorted(misplaced))
        )


def _useful_ffmpeg_error(stderr_text: str) -> str:
    lines = [line.strip() for line in stderr_text.splitlines() if line.strip()]
    preferred = [
        line
        for line in lines
        if any(
            marker in line.lower()
            for marker in (
                "unknown decoder",
                "decoder not found",
                "error opening input",
                "error opening output",
                "invalid argument",
                "conversion failed",
            )
        )
    ]
    useful = preferred[-2:] if preferred else lines[-2:]
    return " ".join(useful)[:600]


def build_full_video_filter_graph(
    source_dimensions: tuple[int, int] | None,
    overlay_dimensions: tuple[int, int],
    output_dimensions: tuple[int, int],
    *,
    source_input: int = 0,
    overlay_input: int = 1,
) -> str:
    width, height = output_dimensions
    parts: list[str] = []
    if source_dimensions == output_dimensions:
        parts.append(f"[{source_input}:v]null[base]")
    else:
        parts.append(
            f"[{source_input}:v]scale={width}:{height}:"
            "force_original_aspect_ratio=disable[base]"
        )
    if overlay_dimensions == output_dimensions:
        parts.append(f"[{overlay_input}:v]format=rgba[ov]")
    else:
        parts.append(
            f"[{overlay_input}:v]scale={width}:{height}:"
            "force_original_aspect_ratio=disable,format=rgba[ov]"
        )
    parts.append("[base][ov]overlay=0:0:format=auto:eof_action=pass:shortest=0[out]")
    return ";".join(parts)


def _constrain_export_dimensions(width: int, height: int, max_long_edge: int) -> tuple[int, int]:
    if max_long_edge <= 0 or max(width, height) <= max_long_edge:
        return width, height
    return scale_dimensions_to_longest_edge(width, height, max_long_edge)


def _normalize_hex_color(value: str | None, fallback: str = "#101010") -> str:
    raw = (value or fallback).strip()
    if raw.startswith("#"):
        raw = raw[1:]
    if len(raw) in {3, 6} and all(ch in "0123456789abcdefABCDEF" for ch in raw):
        if len(raw) == 3:
            raw = "".join(ch * 2 for ch in raw)
        return f"#{raw.lower()}"
    if value != fallback:
        return _normalize_hex_color(fallback, "#101010")
    return "#101010"


def _ffmpeg_color(value: str | None, fallback: str = "#101010") -> str:
    return f"0x{_normalize_hex_color(value, fallback)[1:]}"


class ExportStageError(RuntimeError):
    """Raised when a known export stage fails with a user-actionable message."""

    def __init__(self, stage: str, message: str, cause: Exception | None = None):
        self.stage = stage
        self.cause = cause
        super().__init__(message)


def _log_export_event(event: str, **payload: object) -> None:
    logger.info("%s %s", event, json.dumps(payload, default=str, sort_keys=True))


def _tail(text: str, limit: int = 3000) -> str:
    if len(text) <= limit:
        return text
    return text[-limit:]


def _base64url_json(payload: dict[str, object]) -> str:
    return base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).decode("ascii").rstrip("=")


def _base64url_digest(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def create_render_token(
    export_job_id: str,
    *,
    secret: str | None = None,
    now: int | None = None,
    ttl_seconds: int = RENDER_TOKEN_TTL_SECONDS,
) -> str:
    """Create a short-lived browser-visible token scoped to one render job."""
    resolved_secret = secret or os.getenv("CAPINSTA_RENDER_TOKEN_SECRET", "")
    if not resolved_secret:
        raise ExportStageError(
            "composition_load",
            "CAPINSTA_RENDER_TOKEN_SECRET is not configured for the headless renderer.",
        )
    issued_at = int(now if now is not None else time.time())
    payload = {
        "aud": RENDER_TOKEN_AUDIENCE,
        "export_job_id": export_job_id,
        "exp": issued_at + max(1, int(ttl_seconds)),
    }
    encoded_payload = _base64url_json(payload)
    signature = hmac.new(
        resolved_secret.encode("utf-8"),
        encoded_payload.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{encoded_payload}.{_base64url_digest(signature)}"


def _is_bundled_render_url(render_url: str) -> bool:
    return urlsplit(render_url).path.endswith("/render.html")


def authorize_render_url(render_url: str, export_job_id: str) -> str:
    """Attach an export-job-scoped render token to protected render routes."""
    if _is_bundled_render_url(render_url):
        return render_url

    parts = urlsplit(render_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["export_job_id"] = export_job_id
    query["render_token"] = create_render_token(export_job_id)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def redact_render_url(render_url: str) -> str:
    text = re.sub(r"(?i)(render_token|token|secret)=([^&\s]+)", r"\1=[redacted]", str(render_url))
    parts = urlsplit(text)
    redacted: list[tuple[str, str]] = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key.lower() in {"render_token", "token", "secret"}:
            redacted.append((key, "[redacted]"))
        else:
            redacted.append((key, value))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(redacted), parts.fragment))


def _redirect_chain(response) -> list[str]:
    chain: list[str] = []
    request = getattr(response, "request", None)
    while request is not None:
        chain.append(redact_render_url(getattr(request, "url", "")))
        request = request.redirected_from
    chain.reverse()
    return chain


def _looks_like_sign_in_page(final_url: str, title: str, body_text: str = "") -> bool:
    haystack = f"{final_url}\n{title}\n{body_text}".lower()
    return (
        "/sign-in" in haystack
        or "sign in — capinsta" in haystack
        or "sign in - capinsta" in haystack
    )


def _build_sha() -> str:
    return os.getenv("GIT_SHA") or os.getenv("SOURCE_COMMIT") or os.getenv("COMMIT_SHA") or "unknown"


async def _renderer_ready_diagnostics(
    *,
    page,
    export_job_id: str,
    reason: str,
    page_logs: list[str],
    redirect_chain: list[str] | None = None,
) -> dict[str, object]:
    screenshot_path = ""
    try:
        diagnostic_dir = TEMP_DIR / "export-render-diagnostics"
        diagnostic_dir.mkdir(parents=True, exist_ok=True)
        screenshot = diagnostic_dir / f"{export_job_id}-renderer-ready.png"
        await page.screenshot(path=str(screenshot), full_page=True)
        screenshot_path = str(screenshot)
    except Exception as exc:
        screenshot_path = f"screenshot_failed:{exc}"
    try:
        page_title = await page.title()
    except Exception:
        page_title = ""
    try:
        final_url = redact_render_url(page.url)
    except Exception:
        final_url = ""
    try:
        render_state = await page.evaluate("() => window.__CAPINSTA_RENDER_STATE__ || null")
    except Exception as exc:
        render_state = {"diagnosticError": str(exc)}
    try:
        body_excerpt = await page.evaluate("() => (document.body?.innerText || '').slice(0, 600)")
    except Exception:
        body_excerpt = ""
    return {
        "stage": "renderer_ready",
        "reason": reason,
        "finalUrl": final_url,
        "redirectChain": redirect_chain or [],
        "pageTitle": page_title,
        "bodyExcerpt": redact_render_url(body_excerpt),
        "renderState": render_state,
        "consoleErrors": [line for line in page_logs if line.startswith(("console:", "pageerror:"))][-20:],
        "pageErrors": [line for line in page_logs if line.startswith("pageerror:")][-20:],
        "failedRequests": [line for line in page_logs if line.startswith("requestfailed:")][-20:],
        "screenshotPath": screenshot_path,
        "backendBuildSha": _build_sha(),
        "frontendBuildSha": os.getenv("FRONTEND_BUILD_SHA") or os.getenv("NEXT_PUBLIC_BUILD_SHA") or "unknown",
    }


async def _wait_for_renderer_ready_state(
    *,
    page,
    timeout_ms: int,
    export_job_id: str,
    page_logs: list[str],
    redirect_chain: list[str] | None = None,
) -> dict[str, object]:
    await page.wait_for_function(
        """() => {
            const state = window.__CAPINSTA_RENDER_STATE__;
            return state && (state.status === 'ready' || state.status === 'error');
        }""",
        timeout=timeout_ms,
    )
    render_state = await page.evaluate("() => window.__CAPINSTA_RENDER_STATE__ || null")
    if isinstance(render_state, dict) and render_state.get("status") == "ready":
        return render_state
    diagnostics = await _renderer_ready_diagnostics(
        page=page,
        export_job_id=export_job_id,
        reason="renderer_error_state",
        page_logs=page_logs,
        redirect_chain=redirect_chain,
    )
    error = (render_state or {}).get("error") if isinstance(render_state, dict) else {}
    code = (error or {}).get("code") if isinstance(error, dict) else None
    message = (error or {}).get("message") if isinstance(error, dict) else None
    raise ExportStageError(
        "renderer_ready",
        f"Renderer reported error state {code or 'render_error'}: {message or 'unknown renderer error'} "
        f"Diagnostics: {json.dumps(diagnostics, default=str)}",
    )


def check_export_runtime() -> dict[str, object]:
    """Runtime export diagnostics for /api/health/export."""
    ensure_runtime_dirs()

    export_writable = False
    export_write_error = None
    probe_path = EXPORT_DIR / ".export_health_probe"
    try:
        probe_path.write_text("ok", encoding="utf-8")
        export_writable = True
    except OSError as exc:
        export_write_error = str(exc)
    finally:
        try:
            probe_path.unlink(missing_ok=True)
        except OSError:
            pass

    try:
        import playwright  # noqa: F401

        playwright_package = True
    except Exception:
        playwright_package = False

    return {
        "status": "ok" if shutil.which("ffmpeg") and shutil.which("ffprobe") and export_writable and playwright_package else "degraded",
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ffprobe": bool(shutil.which("ffprobe")),
        "playwright_package": playwright_package,
        "exports_writable": export_writable,
        "exports_write_error": type(export_write_error).__name__ if export_write_error else None,
        "render_page_url": default_render_page_url(),
        "bundled_render_page_url": bundled_render_page_url(),
        "frontend_dist_available": frontend_dist_available(),
        "export_prefer_bundled_render": _bool_env("EXPORT_PREFER_BUNDLED_RENDER", True),
        "export_frame_capture_retries": _int_env("EXPORT_FRAME_CAPTURE_RETRIES", 2),
        "export_render_page_recycle_frames": _int_env("EXPORT_RENDER_PAGE_RECYCLE_FRAMES", 0),
        "export_clean_check_interval_frames": _int_env("EXPORT_CLEAN_CHECK_INTERVAL_FRAMES", 0),
        "render_safe_mode": _bool_env("EXPORT_RENDER_SAFE_MODE", _render_safe_default()),
        "export_max_long_edge": _int_env("EXPORT_MAX_LONG_EDGE", 1920),
        "export_max_fps": _int_env("EXPORT_MAX_FPS", 60),
        "detected_cpu_count": os.cpu_count() or 2,
        "export_ffmpeg_threads_configured": os.getenv("EXPORT_FFMPEG_THREADS", "auto"),
        "export_ffmpeg_threads_resolved": resolve_ffmpeg_threads(),
        "export_sparse_render_enabled": _bool_env("EXPORT_SPARSE_RENDER_ENABLED", False),
        "export_sparse_render_themes": os.getenv("EXPORT_SPARSE_RENDER_THEMES", "*"),
        "export_sparse_min_frame_reduction_percent": _float_env(
            "EXPORT_SPARSE_MIN_FRAME_REDUCTION_PERCENT", 30.0
        ),
    }


async def check_export_runtime_async() -> dict[str, object]:
    if needs_proactor_thread():
        return await run_on_proactor_loop(check_export_runtime_async)

    payload = check_export_runtime()
    chromium_launch = False
    chromium_launch_error = None

    async def probe_chromium() -> None:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--disable-gpu", "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            )
            await browser.close()

    try:
        timeout_seconds = float(os.getenv("EXPORT_HEALTH_CHROMIUM_TIMEOUT_SECONDS", "8"))
        await asyncio.wait_for(probe_chromium(), timeout=max(1.0, timeout_seconds))
        chromium_launch = True
    except asyncio.TimeoutError:
        chromium_launch_error = "Chromium launch probe timed out."
    except Exception as exc:
        chromium_launch_error = f"{type(exc).__name__}: {exc}"

    payload["chromium_launch"] = chromium_launch
    payload["chromium_launch_error"] = chromium_launch_error
    if not chromium_launch:
        payload["status"] = "degraded"
    return payload


async def get_video_duration(video_path: str) -> float:
    """Get video duration in seconds via ffprobe."""
    if not shutil.which("ffprobe"):
        logger.error("ffprobe not found on PATH")
        return 0.0
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            video_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await proc.communicate()
        if proc.returncode != 0:
            logger.error("ffprobe failed exit=%s stderr=%s", proc.returncode, err.decode(errors="replace"))
            return 0.0
        return float(out.decode().strip())
    except Exception as e:
        logger.error(f"ffprobe failed: {e}")
        return 0.0


async def get_video_dimensions(video_path: str) -> tuple[int, int] | None:
    """Get source video width/height via ffprobe."""
    if not shutil.which("ffprobe"):
        return None

    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "json",
            video_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _err = await proc.communicate()
        if proc.returncode != 0:
            return None
        payload = json.loads(out.decode("utf-8", errors="replace") or "{}")
        streams = payload.get("streams") or []
        if not streams:
            return None
        width = int(streams[0].get("width") or 0)
        height = int(streams[0].get("height") or 0)
        if width <= 0 or height <= 0:
            return None
        return width, height
    except Exception:
        return None


def _even(value: float) -> int:
    return max(2, int(round(value / 2.0) * 2))


def scale_dimensions_to_longest_edge(width: int, height: int, target_longest_edge: int) -> tuple[int, int]:
    longest = max(width, height)
    if longest <= 0 or target_longest_edge <= 0:
        return width, height
    factor = target_longest_edge / float(longest)
    return _even(width * factor), _even(height * factor)


async def export_headless(
    job_id: str,
    video_path: str,
    captions_json: str,
    theme: str,
    resolution: str,
    progress_callback: Callable[[str, int, str], Awaitable[None]],
    style_config_json: str | None = None,
    export_width: int | None = None,
    export_height: int | None = None,
    export_fps: int = EXPORT_FPS,
    include_audio: bool = True,
    quality: str = "standard",
    bitrate: str = "auto",
    custom_bitrate_mbps: float | None = None,
    export_mode: str = "full_video",
    background_color: str = "#101010",
    duration_override: float | None = None,
    duration_source: str | None = None,
    hardware_acceleration: bool = False,
    composition_json: str | None = None,
    source_job_id: str | None = None,
    queue_wait_seconds: float = 0.0,
    performance_callback: Callable[[dict[str, object]], Awaitable[None]] | None = None,
) -> str:
    """
    Export video with pixel-perfect burned captions using headless browser.
    
    Returns the path to the output MP4 file.
    """
    if needs_proactor_thread():
        return await run_on_proactor_loop(
            lambda: export_headless(
                job_id=job_id,
                source_job_id=source_job_id,
                video_path=video_path,
                captions_json=captions_json,
                theme=theme,
                resolution=resolution,
                progress_callback=progress_callback,
                style_config_json=style_config_json,
                export_width=export_width,
                export_height=export_height,
                export_fps=export_fps,
                include_audio=include_audio,
                quality=quality,
                bitrate=bitrate,
                custom_bitrate_mbps=custom_bitrate_mbps,
                export_mode=export_mode,
                background_color=background_color,
                duration_override=duration_override,
                duration_source=duration_source,
                hardware_acceleration=hardware_acceleration,
                composition_json=composition_json,
                queue_wait_seconds=queue_wait_seconds,
                performance_callback=performance_callback,
            )
        )

    try:
        from playwright.async_api import async_playwright
    except Exception as exc:
        raise ExportStageError(
            "renderer_launch",
            "Playwright is not installed or cannot be imported. Install backend requirements and run `python -m playwright install chromium`.",
            exc,
        ) from exc

    export_fps = max(1, min(60, int(export_fps or EXPORT_FPS)))
    requested_hardware_acceleration = hardware_acceleration
    hardware_acceleration = bool(
        hardware_acceleration and h264_nvenc_capability_available()
    )
    _log_export_event(
        "export_encoder_capability",
        requestedHardwareAcceleration=requested_hardware_acceleration,
        effectiveHardwareAcceleration=hardware_acceleration,
        codec="h264_nvenc" if hardware_acceleration else "libx264",
    )
    requested_quality = quality
    requested_fps = export_fps
    video_bitrate = None
    if bitrate == "custom" and custom_bitrate_mbps and custom_bitrate_mbps > 0:
        video_bitrate = f"{custom_bitrate_mbps}M"
    elif bitrate in BITRATE_PRESETS:
        video_bitrate = BITRATE_PRESETS[bitrate]
    is_captions_only = export_mode in {
        "captions_only",
        "captions_only_solid_background",
        "captions_solid_background",
    }
    ensure_runtime_dirs()
    output_dir = str(EXPORT_DIR)
    output_suffix = "captions_only" if is_captions_only else "exported"
    export_job_id = f"{job_id}-{int(time.time())}"
    render_started_at = time.perf_counter()

    try:
        parsed_captions = json.loads(captions_json or "[]")
    except json.JSONDecodeError as exc:
        raise ExportStageError("render_input", "Invalid captions JSON sent to export.", exc) from exc
    if not isinstance(parsed_captions, list):
        raise ExportStageError("render_input", "Captions JSON must be a list of caption chunks.")
    if not parsed_captions:
        raise ExportStageError("render_input", "No captions found to export.")
    captions_duration = max(
        (
            timing_end
            for caption in parsed_captions
            if isinstance(caption, dict)
            for timing_end in [
                float(caption.get("end") or 0),
                *[
                    float(word.get("end") or 0)
                    for word in caption.get("words", [])
                    if isinstance(word, dict)
                ],
            ]
        ),
        default=0.0,
    )
    if composition_json and composition_json.strip():
        try:
            parsed_composition = json.loads(composition_json)
        except json.JSONDecodeError as exc:
            raise ExportStageError("render_input", "Invalid composition JSON sent to export.", exc) from exc
        if not isinstance(parsed_composition, dict):
            raise ExportStageError("render_input", "Composition JSON must be an object.")
        layers = parsed_composition.get("layers", [])
        if not isinstance(layers, list):
            raise ExportStageError("render_input", "Composition JSON layers must be a list.")

    media_exists = os.path.exists(video_path)
    if is_captions_only and include_audio and not media_exists:
        logger.warning("captions_only_audio_requested_without_source_media job_id=%s", job_id)
        include_audio = False
    if not is_captions_only and not media_exists:
        raise ExportStageError(
            "media_resolution",
            "Source media file was not found for export.",
        )
    if not shutil.which("ffmpeg"):
        raise ExportStageError("runtime_check", "FFmpeg was not found on PATH. Install FFmpeg or set FFMPEG_PATH.")

    source_dimensions = await get_video_dimensions(video_path) if media_exists else None
    if export_width and export_height and export_width > 0 and export_height > 0:
        width, height = int(export_width), int(export_height)
    else:
        preset_dimensions = RESOLUTION_MAP.get(resolution)
        if source_dimensions and preset_dimensions:
            width, height = scale_dimensions_to_longest_edge(
                source_dimensions[0],
                source_dimensions[1],
                max(preset_dimensions),
            )
        elif source_dimensions:
            width, height = source_dimensions
        elif preset_dimensions:
            width, height = preset_dimensions
        else:
            width, height = (1080, 1920)

    requested_width, requested_height = width, height
    render_safe_mode = _bool_env("EXPORT_RENDER_SAFE_MODE", _render_safe_default())
    max_long_edge = max(0, _int_env("EXPORT_MAX_LONG_EDGE", 1920))
    max_export_fps = max(1, min(60, _int_env("EXPORT_MAX_FPS", 60)))
    ffmpeg_threads = resolve_ffmpeg_threads()
    safe_quality = os.getenv("EXPORT_SAFE_QUALITY", "standard").strip() or "standard"

    width, height = _constrain_export_dimensions(width, height, max_long_edge)
    width, height = max(2, _even(width)), max(2, _even(height))
    if export_fps > max_export_fps:
        export_fps = max_export_fps
    if render_safe_mode and quality in {"best", "high"} and bitrate != "custom":
        quality = safe_quality
    crf = QUALITY_CRF.get(quality, QUALITY_CRF["standard"])

    output_path = os.path.join(output_dir, f"{job_id}_{output_suffix}_{width}x{height}.mp4")

    _log_export_event(
        "export_job_started",
        exportJobId=export_job_id,
        jobId=job_id,
        mode=export_mode,
        mediaExists=media_exists,
        captions=len(parsed_captions),
        width=width,
        height=height,
        requestedWidth=requested_width,
        requestedHeight=requested_height,
        fps=export_fps,
        requestedFps=requested_fps,
        includeAudio=include_audio,
        quality=quality,
        requestedQuality=requested_quality,
        bitrate=bitrate,
        renderSafeMode=render_safe_mode,
        maxLongEdge=max_long_edge,
        ffmpegThreads=ffmpeg_threads,
        outputFile=Path(output_path).name,
    )
    if (width, height) != (requested_width, requested_height) or export_fps != requested_fps or quality != requested_quality:
        logger.warning(
            "export_request_constrained requested=%sx%s@%sfps/%s actual=%sx%s@%sfps/%s render_safe_mode=%s",
            requested_width,
            requested_height,
            requested_fps,
            requested_quality,
            width,
            height,
            export_fps,
            quality,
            render_safe_mode,
        )

    await progress_callback("preparing", 0, "Preparing headless renderer...")

    # Get export duration. The editor sends a duration resolved from timeline,
    # media metadata, captions, or custom settings; ffprobe is a fallback only.
    duration = float(duration_override or 0)
    resolved_duration_source = duration_source or ("frontend" if duration > 0 else "ffprobe")
    if duration <= 0:
        if is_captions_only and captions_duration > 0:
            duration = captions_duration
            resolved_duration_source = "captions"
        elif is_captions_only:
            raise ExportStageError("duration_detection", "Cannot determine captions-only export duration.")
    if duration <= 0:
        if not shutil.which("ffprobe"):
            raise ExportStageError(
                "duration_detection",
                "Export duration was not provided and FFprobe is not available to inspect the source video.",
            )
        duration = await get_video_duration(video_path)
        resolved_duration_source = "ffprobe"
    if duration <= 0:
        raise ExportStageError(
            "duration_detection",
            "Export failed because project duration could not be determined. "
            "Please check media metadata, timeline clips, captions, or export duration settings."
        )

    total_frames = max(1, math.ceil(duration * export_fps))
    performance = ExportPerformanceMetrics(
        export_job_id=export_job_id,
        mode=export_mode,
        duration_seconds=duration,
        fps=export_fps,
        total_frames=total_frames,
        legacy_frames=total_frames,
        queue_wait_seconds=max(0.0, queue_wait_seconds),
    )

    async def emit_performance_summary() -> dict[str, object]:
        total_elapsed = time.perf_counter() - render_started_at
        performance.worker_execution_seconds = total_elapsed
        performance.peak_process_memory_mb = _peak_process_memory_mb()
        summary = performance.to_summary(total_elapsed)
        logger.info("%s", json.dumps(summary, default=str, sort_keys=True))
        if performance_callback:
            await performance_callback(summary)
        return summary

    source_duration = await get_video_duration(video_path) if media_exists else 0.0
    safe_bg = _ffmpeg_color(background_color, fallback="#00ff00" if is_captions_only else "#101010")
    logger.info(
        "Headless export: %s frames @ %sfps, duration=%.2fs source=%s source_video_duration=%.2fs exceeds_source=%s mode=%s",
        total_frames,
        export_fps,
        duration,
        resolved_duration_source,
        source_duration,
        bool(source_duration > 0 and duration > source_duration + (1 / export_fps)),
        export_mode,
    )
    _log_export_event(
        "export_duration_resolved",
        exportJobId=export_job_id,
        duration=duration,
        source=resolved_duration_source,
        totalFrames=total_frames,
        sourceVideoDuration=source_duration,
        exportDurationExceedsSource=bool(source_duration > 0 and duration > source_duration + (1 / export_fps)),
        exportMode=export_mode,
        captionsOnly=is_captions_only,
        width=width,
        height=height,
        fps=export_fps,
        includeAudio=include_audio,
        backgroundColor=_normalize_hex_color(background_color, "#00ff00" if is_captions_only else "#101010"),
        renderUrl=bundled_render_page_url() if frontend_dist_available() else default_render_page_url(),
    )
    if is_captions_only:
        first_caption = parsed_captions[0].get("text") if isinstance(parsed_captions[0], dict) else None
        last_caption = parsed_captions[-1].get("text") if isinstance(parsed_captions[-1], dict) else None
        logger.info(
            "[captions-only duration] durationSec=%.3f durationFrames=%s fps=%s captionsCount=%s firstCaption=%r lastCaption=%r",
            captions_duration,
            math.ceil(captions_duration * export_fps),
            export_fps,
            len(parsed_captions),
            first_caption,
            last_caption,
        )
        logger.info("[render] captions-only mode detected")
        logger.info("[render] using synthetic composition")
        logger.info(
            "[render] width/height/fps/duration/backgroundColor %sx%s %s %.3f %s",
            width,
            height,
            export_fps,
            duration,
            _normalize_hex_color(background_color, "#00ff00"),
        )
        logger.info("[render] active project skipped for captions-only mode")
        logger.info("[render] caption count %s", len(parsed_captions))
        logger.info("[render] audio included %s", bool(include_audio and media_exists))

    browser = None
    browser_context = None
    page = None
    cdp_session = None
    ffmpeg_proc = None
    stderr_chunks: list[bytes] = []
    browser_recovery_attempts = max(0, _int_env("EXPORT_FRAME_CAPTURE_RETRIES", 2))
    render_page_recycle_frames = max(0, _int_env("EXPORT_RENDER_PAGE_RECYCLE_FRAMES", 0))
    clean_check_interval_frames = max(0, _int_env("EXPORT_CLEAN_CHECK_INTERVAL_FRAMES", 0))
    async with _playwright_session(async_playwright) as p:
        replacement_playwright = None

        async def close_page_safely() -> None:
            nonlocal cdp_session, page
            old_cdp, cdp_session = cdp_session, None
            if old_cdp:
                try:
                    await old_cdp.detach()
                except Exception:
                    pass
            old_page, page = page, None
            if old_page:
                try:
                    await old_page.close()
                except Exception:
                    pass

        async def close_context_safely() -> None:
            nonlocal browser_context
            await close_page_safely()
            old_context, browser_context = browser_context, None
            if old_context:
                try:
                    await old_context.close()
                except Exception:
                    pass

        async def close_browser_safely() -> None:
            nonlocal browser
            await close_context_safely()
            old_browser, browser = browser, None
            if old_browser:
                try:
                    await old_browser.close()
                except Exception:
                    pass

        async def launch_browser() -> None:
            nonlocal browser
            await close_browser_safely()
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--disable-gpu",
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-background-networking",
                    "--disable-extensions",
                    "--disable-default-apps",
                    "--disable-sync",
                    "--mute-audio",
                    "--no-first-run",
                    "--disable-background-timer-throttling",
                    "--disable-renderer-backgrounding",
                ],
            )

        async def restart_playwright_and_browser() -> None:
            nonlocal p, replacement_playwright
            await close_browser_safely()
            if replacement_playwright is not None:
                try:
                    await replacement_playwright.stop()
                except Exception:
                    pass
            replacement_playwright = await async_playwright().start()
            p = replacement_playwright
            await launch_browser()

        async def shutdown_renderer() -> None:
            nonlocal replacement_playwright
            await close_browser_safely()
            if replacement_playwright is not None:
                try:
                    await replacement_playwright.stop()
                except Exception:
                    pass
                replacement_playwright = None

        try:
            # Launch headless Chromium
            browser_launch_started = time.perf_counter()
            await launch_browser()
            performance.browser_launch_seconds += time.perf_counter() - browser_launch_started
        except Exception as exc:
            raise ExportStageError(
                "renderer_launch",
                f"Chromium could not launch for export: {exc}",
                exc,
            ) from exc

        page_logs: list[str] = []

        def capture_page_log(prefix: str, message: str) -> None:
            line = f"{prefix}: {redact_render_url(message)}"
            page_logs.append(line)
            if len(page_logs) > 40:
                del page_logs[: len(page_logs) - 40]

        await progress_callback("preparing", 2, "Loading render page...")

        # Prefer the bundled static render page for long exports. Next dev/HMR
        # pages are useful while editing, but they are much easier to crash
        # during thousands of frame screenshots.
        raw_render_page_candidates: list[str] = []
        bundled_render_url = bundled_render_page_url()
        configured_render_url = default_render_page_url()
        prefer_bundled_render = frontend_dist_available() and _bool_env("EXPORT_PREFER_BUNDLED_RENDER", True)
        if prefer_bundled_render:
            raw_render_page_candidates.append(bundled_render_url)
        raw_render_page_candidates.append(configured_render_url)
        if frontend_dist_available() and bundled_render_url not in raw_render_page_candidates:
            raw_render_page_candidates.append(bundled_render_url)

        render_page_candidates = [
            authorize_render_url(candidate, job_id)
            for candidate in raw_render_page_candidates
        ]
        render_page_url = render_page_candidates[0]
        render_load_errors: list[str] = []
        loaded_render_page = False
        active_redirect_chain: list[str] = []
        render_page_timeout_ms = max(1000, _int_env("CAPINSTA_RENDER_PAGE_TIMEOUT_MS", 30000))
        navigation_timeout_ms = render_page_timeout_ms
        render_ready_timeout_ms = render_page_timeout_ms
        for candidate_url in render_page_candidates:
            logger.info("headless_render_page url=%s", redact_render_url(candidate_url))
            try:
                page_load_started = time.perf_counter()
                await close_context_safely()
                page_logs.clear()
                browser_context = await browser.new_context(
                    viewport={"width": width, "height": height},
                    device_scale_factor=1,
                )
                page = await browser_context.new_page()
                cdp_session = await browser_context.new_cdp_session(page)
                if not is_captions_only:
                    await cdp_session.send(
                        "Emulation.setDefaultBackgroundColorOverride",
                        {"color": {"r": 0, "g": 0, "b": 0, "a": 0}},
                    )
                page.on("console", lambda msg: capture_page_log("console", msg.text))
                page.on("pageerror", lambda exc: capture_page_log("pageerror", str(exc)))
                page.on("requestfailed", lambda request: capture_page_log("requestfailed", f"{request.url} {request.failure}"))

                response = await page.goto(candidate_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                if response is None:
                    raise ExportStageError("composition_load", f"Render page did not return a response: {redact_render_url(candidate_url)}")
                page_title = await page.title()
                final_url = page.url
                redirect_chain = _redirect_chain(response)
                active_redirect_chain = redirect_chain
                readiness_probe = await page.evaluate(
                    """() => ({
                        loadedFlag: window.__RENDER_PAGE_LOADED__ === true,
                        explicitReadyFlag: window.__CAPINSTA_RENDER_READY__ === true,
                        renderState: window.__CAPINSTA_RENDER_STATE__ || null,
                        hasRendererRoot: Boolean(document.querySelector("#render-frame")),
                        hasAuthError: Boolean(document.querySelector("[data-render-auth-error='true']")),
                        hasSignInForm: Boolean(document.querySelector("form")) && /sign in/i.test(document.body?.innerText || "")
                    })"""
                )
                logger.info(
                    "headless_render_page_loaded requested_url=%s status=%s final_url=%s title=%s redirects=%s readiness_probe=%s",
                    redact_render_url(candidate_url),
                    response.status,
                    redact_render_url(final_url),
                    page_title,
                    json.dumps(redirect_chain, default=str),
                    json.dumps(readiness_probe, default=str),
                )
                auth_body_sample = ""
                if isinstance(readiness_probe, dict) and (
                    readiness_probe.get("hasAuthError") or readiness_probe.get("hasSignInForm")
                ):
                    auth_body_sample = await page.evaluate("() => (document.body?.innerText || '').slice(0, 400)")
                if _looks_like_sign_in_page(final_url, page_title, auth_body_sample):
                    raise ExportStageError(
                        "composition_load",
                        "Headless renderer was redirected to the sign-in page. "
                        "Check render-route authentication and internal render-token configuration.",
                    )
                if response.status >= 400:
                    raise ExportStageError(
                        "composition_load",
                        f"Render page returned HTTP {response.status}: {redact_render_url(candidate_url)}",
                    )
                if isinstance(readiness_probe, dict) and readiness_probe.get("hasAuthError"):
                    raise ExportStageError(
                        "composition_load",
                        f"Render page rejected the render token at {redact_render_url(candidate_url)}.",
                    )

                await page.wait_for_function(
                    "() => window.__CAPINSTA_RENDER_STATE__ && window.__CAPINSTA_RENDER_STATE__.version === 1",
                    timeout=render_ready_timeout_ms,
                )
                performance.render_page_load_seconds += time.perf_counter() - page_load_started
                render_page_url = candidate_url
                loaded_render_page = True
                break
            except ExportStageError as exc:
                performance.render_page_load_seconds += time.perf_counter() - page_load_started
                render_load_errors.append(str(exc))
                await close_context_safely()
            except Exception as exc:
                performance.render_page_load_seconds += time.perf_counter() - page_load_started
                render_load_errors.append(f"Could not load the caption render page at {redact_render_url(candidate_url)}: {exc}")
                await close_context_safely()

        if not loaded_render_page:
            logs = _tail("\n".join(page_logs), 1400)
            detail_parts = render_load_errors[-2:] if render_load_errors else []
            if logs:
                detail_parts.append(f"Render logs: {logs}")
            detail = f" {' | '.join(detail_parts)}" if detail_parts else ""
            await close_browser_safely()
            raise ExportStageError(
                "composition_load",
                f"Could not load the caption render page at {redact_render_url(render_page_candidates[0])}.{detail}",
            )

        if page is None:
            await close_browser_safely()
            raise ExportStageError("composition_load", "Render page loaded flag was set, but no page instance remained available.")

        overlay_capture_rect = {
            "x": 0.0,
            "y": 0.0,
            "width": float(width),
            "height": float(height),
        }

        async def capture_render_frame() -> bytes:
            """Capture a single caption frame for the export.

            Captions-only mode: the render composition root has the user-selected
            background color painted directly (via inline styles on html/body/#
            render-frame). We capture with omit_background=False so the solid
            background is included in the PNG. The FFmpeg pipeline still creates
            a matching-color canvas, but the overlay is opaque where there are no
            captions — which is visually identical.

            Full-video mode: the overlay must be transparent so the source video
            shows through. We use omit_background=True for transparent PNGs.
            """
            # For captions-only, we want the background painted INTO the frame.
            # For full-video, we want transparent overlay on source video.
            omit_bg = not is_captions_only
            try:
                # CDP's optimizeForSpeed path avoids Playwright locator setup and
                # uses Chromium's faster screenshot encoder. It is materially
                # faster for production-sized transparent overlays.
                if cdp_session is not None:
                    result = await cdp_session.send(
                        "Page.captureScreenshot",
                        {
                            "format": "png",
                            "fromSurface": True,
                            "captureBeyondViewport": False,
                            "optimizeForSpeed": True,
                            "clip": {
                                **overlay_capture_rect,
                                "scale": 1,
                            },
                        },
                    )
                    encoded = result.get("data") if isinstance(result, dict) else None
                    if encoded:
                        return base64.b64decode(encoded)

                # Primary: screenshot the export overlay root element directly.
                # It is position:fixed at {0,0} sized to export dimensions, so an
                # element screenshot captures exactly the caption overlay region.
                try:
                    overlay_root = page.locator('[data-capinsta-export-overlay-root="true"]')
                    if await overlay_root.count() > 0:
                        return await overlay_root.screenshot(
                            type="png",
                            omit_background=omit_bg,
                            timeout=5000,
                        )
                except Exception:
                    pass  # Fall through to viewport screenshot

                # Fallback: viewport screenshot clipped to export dimensions.
                return await page.screenshot(
                    type="png",
                    omit_background=omit_bg,
                    clip={"x": 0, "y": 0, "width": width, "height": height},
                    timeout=10000,
                )
            except Exception as viewport_exc:
                try:
                    element = page.locator("#render-frame")
                    return await element.screenshot(
                        type="png",
                        omit_background=omit_bg,
                        timeout=5000,
                    )
                except Exception as locator_exc:
                    try:
                        page_state = await page.evaluate(
                            """() => ({
                                url: window.location.href,
                                loaded: window.__RENDER_PAGE_LOADED__ === true,
                                ready: typeof window.isReady === "function" ? window.isReady() : false,
                                hasFrame: Boolean(document.querySelector("#render-frame")),
                                hasExportRoot: Boolean(document.querySelector('[data-capinsta-export-overlay-root="true"]')),
                                overlayOnly: Boolean(window.__OVERLAY_ONLY_MODE__),
                                overlayRect: window.__EXPORT_OVERLAY_RECT__ || null,
                                debugOverlaysFound: window.__EXPORT_DEBUG_OVERLAYS_FOUND__ ?? null,
                                bodyText: (document.body?.innerText || "").slice(0, 600)
                            })"""
                        )
                    except Exception as state_exc:
                        page_state = {"stateError": f"{type(state_exc).__name__}: {state_exc}"}
                    logs = _tail("\n".join(page_logs), 1400)
                    detail = (
                        f"Viewport screenshot failed: {type(viewport_exc).__name__}: {viewport_exc}. "
                        f"Render frame screenshot failed: {type(locator_exc).__name__}: {locator_exc}. "
                        f"Render page state: {json.dumps(page_state, default=str)}"
                    )
                    if logs:
                        detail = f"{detail} Render logs: {logs}"
                    raise ExportStageError("frame_capture", detail, locator_exc) from locator_exc

        async def timed_capture_render_frame() -> bytes:
            capture_started = time.perf_counter()
            data = await capture_render_frame()
            performance.record_screenshot(time.perf_counter() - capture_started, len(data))
            return data

        async def inject_caption_data() -> None:
            if page is None:
                raise ExportStageError("composition_load", "Render page is not available for caption injection.")
            # The render page fetches the original video via
            # /api/jobs/${jobId}/video, which resolves by the SOURCE caption job
            # id (not the export job id). Pass source_job_id when available.
            video_fetch_job_id = source_job_id or job_id
            injection_started = time.perf_counter()
            try:
                inject_result = await page.evaluate(
                    "([json, t, w, h, styleJson, fps, bg, compositionJson, renderMode, jobId, duration, audioIncluded]) => window.setCaptionData(json, t, w, h, styleJson, fps, bg, compositionJson, renderMode, jobId, duration, audioIncluded)",
                    [
                        captions_json,
                        theme,
                        width,
                        height,
                        style_config_json or "",
                        export_fps,
                        background_color or ("#00FF00" if is_captions_only else "transparent"),
                        "" if is_captions_only else (composition_json or ""),
                        "captions_only" if is_captions_only else "full_video",
                        video_fetch_job_id,
                        duration,
                        bool(include_audio and media_exists),
                    ]
                )
            except Exception as exc:
                logs = _tail("\n".join(page_logs), 1400)
                detail = f" Render logs: {logs}" if logs else ""
                raise ExportStageError("composition_load", f"Failed to inject captions into render page.{detail}", exc) from exc
            finally:
                performance.caption_injection_seconds += time.perf_counter() - injection_started

            # setCaptionData now returns { ok: boolean, error?: string, detail?: string }
            # instead of a bare boolean, so we can surface the real failure reason.
            if isinstance(inject_result, dict):
                if not inject_result.get("ok"):
                    err_msg = inject_result.get("error") or "Render page rejected the caption data (unknown reason)."
                    err_detail = inject_result.get("detail") or ""
                    logs = _tail("\n".join(page_logs), 1400)
                    log_suffix = f" Render logs: {logs}" if logs else ""
                    full_detail = f"{err_detail}{log_suffix}".strip()
                    raise ExportStageError(
                        "composition_load",
                        f"{err_msg}. {full_detail}".strip(),
                    )
            elif inject_result is False or inject_result is None:
                # Backwards-compat: older render pages return bare false.
                logs = _tail("\n".join(page_logs), 1400)
                last_err = await page.evaluate("() => window.__RENDER_PAGE_LAST_ERROR__ || ''")
                detail_parts = []
                if last_err:
                    detail_parts.append(f"Render page error: {last_err}")
                if logs:
                    detail_parts.append(f"Render logs: {logs}")
                detail = f" {' | '.join(detail_parts)}" if detail_parts else ""
                raise ExportStageError(
                    "composition_load",
                    f"Render page rejected the caption data.{detail}",
                )

        async def wait_for_fonts() -> None:
            if page is None:
                raise ExportStageError("render_readiness", "Render page is unavailable while waiting for fonts.")
            fonts_started = time.perf_counter()
            try:
                await page.evaluate("() => document.fonts ? document.fonts.ready.then(() => true) : true")
                readiness = await page.evaluate(
                    "() => window.__CAPINSTA_FONT_READINESS__ || null"
                )
                if isinstance(readiness, dict):
                    logger.info(
                        "caption_font_readiness export_job_id=%s ready=%s fonts=%s",
                        export_job_id,
                        readiness.get("ready"),
                        json.dumps(readiness.get("fonts") or [], default=str),
                    )
                    if not readiness.get("ready", False):
                        failed = [
                            str(font.get("label") or font.get("cssFamily") or "unknown")
                            for font in readiness.get("fonts") or []
                            if isinstance(font, dict) and not font.get("check")
                        ]
                        raise ExportStageError(
                            "render_readiness",
                            "Requested caption font did not load in the export renderer"
                            + (f": {', '.join(failed)}." if failed else "."),
                        )
            except Exception as exc:
                if isinstance(exc, ExportStageError):
                    raise
                raise ExportStageError("render_readiness", f"Render fonts did not become ready: {exc}", exc) from exc
            finally:
                performance.font_readiness_seconds += time.perf_counter() - fonts_started

        async def assert_render_clean(*, strict: bool, context: str) -> None:
            if page is None:
                raise ExportStageError("render_readiness", "Render page is unavailable for cleanliness validation.")
            try:
                clean_result = await page.evaluate(
                    "() => (typeof window.assertExportClean === 'function' ? window.assertExportClean() : { ok: true, debugOverlaysFound: 0 })"
                )
            except Exception as exc:
                if strict:
                    raise ExportStageError(
                        "render_readiness",
                        f"Could not validate the export render route ({context}): {exc}",
                        exc,
                    ) from exc
                logger.warning("assertExportClean evaluation failed context=%s: %s", context, exc)
                return
            if isinstance(clean_result, dict) and not clean_result.get("ok", True):
                reason = clean_result.get("reason") or "prohibited application UI present"
                found = clean_result.get("debugOverlaysFound", 0)
                raise ExportStageError(
                    "render_readiness",
                    f"Export blocked: {reason} ({found} elements found) during {context}.",
                )

        async def recreate_render_page(
            current_time: float,
            reason: Exception,
            current_frame: int | None = None,
        ) -> None:
            nonlocal browser_context, cdp_session, page
            restart_started = time.perf_counter()
            performance.renderer_restarts += 1
            is_disconnect_recovery = _looks_like_browser_disconnect(reason)
            if is_disconnect_recovery:
                performance.browser_recoveries += 1
            logger.warning(
                "recovering_render_page export_job_id=%s time=%.3f reason=%s: %s",
                export_job_id,
                current_time,
                type(reason).__name__,
                reason,
            )
            await close_context_safely()
            try:
                browser_connected = bool(browser and browser.is_connected())
            except Exception:
                browser_connected = False
            if is_disconnect_recovery:
                relaunch_started = time.perf_counter()
                await restart_playwright_and_browser()
                performance.browser_launch_seconds += time.perf_counter() - relaunch_started
            elif browser is None or not browser_connected:
                relaunch_started = time.perf_counter()
                await launch_browser()
                performance.browser_launch_seconds += time.perf_counter() - relaunch_started
            page_logs.clear()
            browser_context = await browser.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=1,
            )
            page = await browser_context.new_page()
            cdp_session = await browser_context.new_cdp_session(page)
            if not is_captions_only:
                await cdp_session.send(
                    "Emulation.setDefaultBackgroundColorOverride",
                    {"color": {"r": 0, "g": 0, "b": 0, "a": 0}},
                )
            page.on("console", lambda msg: capture_page_log("console", msg.text))
            page.on("pageerror", lambda exc: capture_page_log("pageerror", str(exc)))
            page.on("requestfailed", lambda request: capture_page_log("requestfailed", f"{request.url} {request.failure}"))
            response = await page.goto(render_page_url, wait_until="domcontentloaded", timeout=render_page_timeout_ms)
            if response is None or response.status >= 400:
                status = "no response" if response is None else f"HTTP {response.status}"
                raise ExportStageError("composition_load", f"Render page reload failed during export recovery: {status} {redact_render_url(render_page_url)}")
            page_title = await page.title()
            if _looks_like_sign_in_page(page.url, page_title):
                raise ExportStageError(
                    "composition_load",
                    "Headless renderer was redirected to the sign-in page during recovery. "
                    "Check render-route authentication and internal render-token configuration.",
                )
            recovery_redirect_chain = _redirect_chain(response)
            await page.wait_for_function(
                "() => window.__CAPINSTA_RENDER_STATE__ && window.__CAPINSTA_RENDER_STATE__.version === 1",
                timeout=render_page_timeout_ms,
            )
            await inject_caption_data()
            await wait_for_fonts()
            try:
                await _wait_for_renderer_ready_state(
                    page=page,
                    timeout_ms=render_page_timeout_ms,
                    export_job_id=export_job_id,
                    page_logs=page_logs,
                    redirect_chain=recovery_redirect_chain,
                )
            except Exception:
                logger.warning("render_ready_failure during page recovery export_job_id=%s", export_job_id)
                raise
            try:
                await page.evaluate("() => typeof window.stripProhibitedRenderUI === 'function' && window.stripProhibitedRenderUI()")
            except Exception:
                pass
            if is_captions_only and current_frame is not None:
                advance_started = time.perf_counter()
                await page.evaluate("(frame) => window.setCaptionFrame(frame)", current_frame)
                performance.frame_advance_seconds += time.perf_counter() - advance_started
            else:
                advance_started = time.perf_counter()
                await page.evaluate("(time) => window.setCaptionTime(time)", current_time)
                performance.frame_advance_seconds += time.perf_counter() - advance_started
            await assert_render_clean(strict=True, context="post-recovery")
            performance.renderer_restart_seconds += time.perf_counter() - restart_started

        # Inject caption data via proper serialization (avoids string escaping issues)
        try:
            await inject_caption_data()
            await wait_for_fonts()
        except Exception as exc:
            await close_browser_safely()
            raise

        # --- Wait for explicit render readiness (not an arbitrary timeout) ---
        # The render page signals readiness after: caption data loaded, fonts
        # ready, background color applied, output dimensions applied, prohibited
        # UI stripped, and first caption frame committed.
        await progress_callback("preparing", 3, "Waiting for render readiness...")
        readiness_started = time.perf_counter()
        try:
            await _wait_for_renderer_ready_state(
                page=page,
                timeout_ms=render_ready_timeout_ms,
                export_job_id=export_job_id,
                page_logs=page_logs,
                redirect_chain=active_redirect_chain,
            )
            readiness = await page.evaluate(
                """() => {
                    const r = typeof window.getRenderReadiness === 'function'
                        ? window.getRenderReadiness() : null;
                    return {
                        renderMode: window.__EXPORT_APPLIED_RENDER_MODE__ || null,
                        backgroundColor: window.__EXPORT_APPLIED_BACKGROUND_COLOR__ || null,
                        outputSize: window.__EXPORT_OUTPUT_SIZE__ || null,
                        readiness: r,
                    };
                }"""
            )
            logger.info(
                "render_ready job_id=%s mode=%s bg=%s size=%s readiness=%s",
                job_id,
                readiness.get("renderMode"),
                readiness.get("backgroundColor"),
                readiness.get("outputSize"),
                json.dumps(readiness.get("readiness"), default=str) if readiness.get("readiness") else "null",
            )
            ready_reason = await page.evaluate(
                "() => document.documentElement.dataset.renderReadyReason || 'unknown'"
            )
            # Stable, grep-friendly production diagnostics. These are emitted
            # by the worker even when a production JS compiler strips browser
            # console.info calls from the render bundle.
            logger.info("[render] renderMode: %s", readiness.get("renderMode"))
            logger.info("[render] requested backgroundColor: %s", background_color)
            logger.info(
                "[render] applied composition backgroundColor: %s",
                readiness.get("backgroundColor"),
            )
            logger.info("[render] output size: %sx%s", width, height)
            logger.info("[render] renderReady: %s", ready_reason)
        except Exception as exc:
            if isinstance(exc, ExportStageError):
                raise
            try:
                diag = await _renderer_ready_diagnostics(
                    page=page,
                    export_job_id=export_job_id,
                    reason="render_state_never_ready",
                    page_logs=page_logs,
                    redirect_chain=active_redirect_chain,
                )
            except Exception as diag_exc:
                diag = {"diagnosticError": str(diag_exc)}
            logs = _tail("\n".join(page_logs), 1600)
            raise ExportStageError(
                "renderer_ready",
                "Renderer never reached ready state before timeout. "
                f"Diagnostics: {json.dumps(diag, default=str)}"
                + (f" | Render logs: {logs}" if logs else ""),
                exc,
            ) from exc
        finally:
            performance.first_frame_readiness_seconds += time.perf_counter() - readiness_started

        # --- Assert the render route is clean: no cookie banner, toasts, or
        #     fixed application UI. The render page's assertExportClean()
        #     first defensively strips known prohibited elements. ---
        await assert_render_clean(strict=True, context="initial-frame")

        # --- Defensive: explicitly strip any prohibited UI elements that may
        #     have mounted despite the route exclusion (belt + suspenders). ---
        try:
            stripped_count = await page.evaluate(
                "() => (typeof window.stripProhibitedRenderUI === 'function' ? window.stripProhibitedRenderUI() : 0)"
            )
            if stripped_count and stripped_count > 0:
                logger.warning(
                    "render_defensive_strip job_id=%s stripped=%d prohibited UI elements before capture",
                    job_id, stripped_count,
                )
        except Exception as strip_exc:
            logger.debug("stripProhibitedRenderUI failed (non-fatal): %s", strip_exc)

        # --- Validation: verify overlay element + no debug overlays ---
        await progress_callback("preparing", 4, "Validating render state...")
        overlay_capture_dimensions = (width, height)
        try:
            overlay_root_count = await page.locator('[data-capinsta-export-overlay-root="true"]').count() if page else 0
            render_mode_info = await page.evaluate("() => ({ overlayOnly: Boolean(window.__OVERLAY_ONLY_MODE__), mode: window.HUYGEN_RENDER_MODE })") if page else {}
            overlay_rect = await page.evaluate("() => window.__EXPORT_OVERLAY_RECT__ || null") if page else None
            style_hash = await page.evaluate("() => window.__EXPORT_STYLE_HASH__ || null") if page else None
            style_info = await page.evaluate("() => window.__EXPORT_STYLE_INFO__ || null") if page else None
            layout_info = await page.evaluate("() => window.__EXPORT_LAYOUT_INFO__ || null") if page else None
            layout_hash = await page.evaluate("() => window.__EXPORT_LAYOUT_HASH__ || null") if page else None
            logger.info(
                "post_inject_validation job_id=%s overlayRoot=%s overlayOnly=%s mode=%s overlayRect=%s styleHash=%s styleInfo=%s layoutHash=%s layoutInfo=%s",
                job_id,
                overlay_root_count,
                render_mode_info.get("overlayOnly") if isinstance(render_mode_info, dict) else None,
                render_mode_info.get("mode") if isinstance(render_mode_info, dict) else None,
                json.dumps(overlay_rect) if overlay_rect else None,
                style_hash,
                json.dumps(style_info) if style_info else None,
                layout_hash,
                json.dumps(layout_info) if layout_info else None,
            )
            if overlay_root_count == 0:
                logger.warning("post_inject_validation NO export overlay root found on render page — captions may not render")

            # The overlay root is now sized to the PROJECT CANVAS (not the export
            # resolution), so validate against the canvas dimensions reported by
            # __EXPORT_LAYOUT_INFO__. FFmpeg scales the overlay to the output
            # resolution during compositing.
            canvas_w = None
            canvas_h = None
            if isinstance(layout_info, dict):
                canvas_w = layout_info.get("canvasWidth")
                canvas_h = layout_info.get("canvasHeight")
            if isinstance(overlay_rect, dict):
                rect_w = overlay_rect.get("width")
                rect_h = overlay_rect.get("height")
                if isinstance(rect_w, (int, float)) and isinstance(rect_h, (int, float)):
                    overlay_capture_dimensions = (int(round(rect_w)), int(round(rect_h)))
                    overlay_capture_rect = {
                        "x": max(0.0, float(overlay_rect.get("x") or 0)),
                        "y": max(0.0, float(overlay_rect.get("y") or 0)),
                        "width": max(1.0, float(rect_w)),
                        "height": max(1.0, float(rect_h)),
                    }
                # Compare against the canvas dims (from layout info) if available,
                # otherwise fall back to the export dims.
                expected_w = canvas_w if canvas_w else width
                expected_h = canvas_h if canvas_h else height
                if rect_w != expected_w or rect_h != expected_h:
                    logger.warning(
                        "post_inject_validation overlay root rect mismatch: got %sx%s expected %sx%s (canvas=%sx%s export=%sx%s)",
                        rect_w, rect_h, expected_w, expected_h,
                        canvas_w, canvas_h, width, height,
                    )
        except Exception as val_exc:
            logger.warning("post_inject_validation check failed (non-fatal): %s", val_exc)

        await progress_callback("capturing", 5, "Starting caption capture...")

        try:
            parsed_style_config = json.loads(style_config_json) if style_config_json else {}
            if not isinstance(parsed_style_config, dict):
                parsed_style_config = {}
        except json.JSONDecodeError:
            parsed_style_config = {}
        sparse_themes = {
            item.strip()
            for item in os.getenv("EXPORT_SPARSE_RENDER_THEMES", "*").split(",")
            if item.strip()
        }
        selected_engine, engine_reason = select_render_engine(
            theme,
            parsed_style_config,
            export_mode,
            sparse_enabled=_bool_env("EXPORT_SPARSE_RENDER_ENABLED", False),
            sparse_themes=sparse_themes,
        )
        performance.render_engine = selected_engine.value
        _log_export_event(
            "export_render_engine_selected",
            exportJobId=export_job_id,
            engine=selected_engine.value,
            reason=engine_reason,
            theme=theme,
        )

        async def run_checkpointed_export() -> str:
            capture_root = Path(
                tempfile.mkdtemp(
                    prefix=f"capinsta_capture_{job_id}_", dir=str(TEMP_DIR)
                )
            )
            checkpoint_path = capture_root / "checkpoint.json"
            capture_started = time.perf_counter()
            capture_attempts = max(1, min(2, _int_env("EXPORT_CAPTURE_CHUNK_ATTEMPTS", 2)))
            chunk_size = max(25, _int_env("EXPORT_CAPTURE_CHUNK_FRAMES", 200))
            use_sparse = selected_engine is RenderEngine.BROWSER_SPARSE
            plan = None

            if use_sparse:
                plan_started = time.perf_counter()
                plan = build_sparse_caption_render_plan(
                    parsed_captions,
                    export_fps,
                    theme,
                    parsed_style_config,
                    duration,
                )
                performance.sparse_plan_seconds += time.perf_counter() - plan_started
                reduction = (1 - len(plan) / total_frames) * 100 if total_frames else 0.0
                minimum_reduction = max(
                    0.0,
                    _float_env("EXPORT_SPARSE_MIN_FRAME_REDUCTION_PERCENT", 30.0),
                )
                if reduction < minimum_reduction:
                    use_sparse = False
                    plan = None
                    performance.render_engine = RenderEngine.BROWSER_FULL_FRAME.value
                    logger.info(
                        "checkpoint_sparse_fallback export_job_id=%s reduction=%.3f minimum=%.3f",
                        export_job_id,
                        reduction,
                        minimum_reduction,
                    )

            required_captures = len(plan) if plan is not None else total_frames
            frame_paths = [
                capture_root / f"frame_{index:06d}.png"
                for index in range(required_captures)
            ]

            async def write_checkpoint(
                *,
                completed: int,
                mode: str,
                chunk_start: int,
                chunk_end: int,
            ) -> None:
                payload = {
                    "mode": mode,
                    "completedCaptures": completed,
                    "totalCaptures": required_captures,
                    "chunkStart": chunk_start,
                    "chunkEndExclusive": chunk_end,
                    "elapsedSeconds": round(time.perf_counter() - capture_started, 6),
                }
                await asyncio.to_thread(
                    checkpoint_path.write_text,
                    json.dumps(payload, sort_keys=True),
                    "utf-8",
                )

            async def write_png(index: int, data: bytes) -> None:
                target = frame_paths[index]
                temporary = target.with_suffix(".png.part")
                await asyncio.to_thread(temporary.write_bytes, data)
                await asyncio.to_thread(temporary.replace, target)

            async def delete_range(start: int, end: int) -> None:
                await asyncio.to_thread(
                    _discard_capture_range,
                    frame_paths,
                    start,
                    end,
                )

            async def start_fresh_renderer(capture_frame: int) -> None:
                await restart_playwright_and_browser()
                await recreate_render_page(
                    capture_frame / export_fps,
                    ExportStageError(
                        "frame_capture",
                        f"Starting fresh renderer for capture frame {capture_frame}.",
                    ),
                    capture_frame,
                )

            async def capture_frame_to_disk(output_index: int, timeline_frame: int) -> None:
                if page is None:
                    raise ExportStageError("frame_capture", "Render page is not available.")
                advance_started = time.perf_counter()
                advanced = await page.evaluate(
                    "(frame) => window.setCaptionFrame(frame)",
                    timeline_frame,
                )
                performance.frame_advance_seconds += time.perf_counter() - advance_started
                if advanced is not True:
                    raise ExportStageError(
                        "frame_capture",
                        f"Caption renderer rejected frame {timeline_frame}.",
                    )
                await write_png(output_index, await timed_capture_render_frame())

            try:
                # The initial renderer validated the packaged route. Capture uses
                # fresh Playwright/browser ownership per chunk from this point on.
                await close_browser_safely()

                if plan is not None:
                    sparse_chunk_size = max(
                        1,
                        _int_env("EXPORT_SPARSE_CAPTURE_CHUNK_STATES", 100),
                    )
                    for chunk_start, chunk_end in _capture_chunks(len(plan), sparse_chunk_size):
                        await start_fresh_renderer(plan[chunk_start].capture_frame)
                        try:
                            for index in range(chunk_start, chunk_end):
                                segment = plan[index]
                                last_error: Exception | None = None
                                for attempt in range(capture_attempts):
                                    attempt_started = time.perf_counter()
                                    try:
                                        if attempt > 0:
                                            await start_fresh_renderer(segment.capture_frame)
                                        await capture_frame_to_disk(index, segment.capture_frame)
                                        await write_checkpoint(
                                            completed=index + 1,
                                            mode="sparse",
                                            chunk_start=index,
                                            chunk_end=index + 1,
                                        )
                                        _log_export_event(
                                            "capture_attempt_complete",
                                            exportJobId=export_job_id,
                                            mode="sparse",
                                            captureIndex=index,
                                            attempt=attempt + 1,
                                            elapsedSeconds=round(
                                                time.perf_counter() - attempt_started,
                                                6,
                                            ),
                                            totalElapsedSeconds=round(
                                                time.perf_counter() - render_started_at,
                                                6,
                                            ),
                                        )
                                        last_error = None
                                        break
                                    except Exception as exc:
                                        last_error = exc
                                        logger.exception(
                                            "sparse_capture_attempt_failed export_job_id=%s index=%s "
                                            "timeline_frame=%s attempt=%s/%s elapsed_seconds=%.6f",
                                            export_job_id,
                                            index,
                                            segment.capture_frame,
                                            attempt + 1,
                                            capture_attempts,
                                            time.perf_counter() - attempt_started,
                                        )
                                        await shutdown_renderer()
                                        await delete_range(index, index + 1)
                                        if (
                                            attempt + 1 >= capture_attempts
                                            or not _looks_like_browser_disconnect(exc)
                                        ):
                                            break
                                        await progress_callback(
                                            "capturing",
                                            _capture_progress(index, required_captures),
                                            "Retrying caption capture chunk",
                                        )
                                if last_error is not None:
                                    raise ExportStageError(
                                        "frame_capture",
                                        f"Caption capture failed for sparse state {index + 1}/"
                                        f"{required_captures} after {capture_attempts} attempts. "
                                        "Previously completed "
                                        "captures were preserved, but the export could not continue.",
                                        last_error,
                                    ) from last_error
                                await progress_callback(
                                    "capturing",
                                    _capture_progress(index + 1, required_captures),
                                    f"Capturing captions: {index + 1}/{required_captures}",
                                )
                        finally:
                            await shutdown_renderer()
                    performance.sparse_capture_seconds += time.perf_counter() - capture_started
                else:
                    for chunk_start, chunk_end in _capture_chunks(total_frames, chunk_size):
                        chunk_error: Exception | None = None
                        for attempt in range(capture_attempts):
                            attempt_started = time.perf_counter()
                            await delete_range(chunk_start, chunk_end)
                            try:
                                await start_fresh_renderer(chunk_start)
                                for frame_index in range(chunk_start, chunk_end):
                                    await capture_frame_to_disk(frame_index, frame_index)
                                await write_checkpoint(
                                    completed=chunk_end,
                                    mode="full_frame",
                                    chunk_start=chunk_start,
                                    chunk_end=chunk_end,
                                )
                                _log_export_event(
                                    "capture_chunk_complete",
                                    exportJobId=export_job_id,
                                    startFrame=chunk_start,
                                    endFrameExclusive=chunk_end,
                                    attempt=attempt + 1,
                                    chunkElapsedSeconds=round(
                                        time.perf_counter() - attempt_started,
                                        6,
                                    ),
                                    totalElapsedSeconds=round(
                                        time.perf_counter() - render_started_at,
                                        6,
                                    ),
                                )
                                chunk_error = None
                                break
                            except Exception as exc:
                                chunk_error = exc
                                logger.exception(
                                    "capture_chunk_attempt_failed export_job_id=%s frames=%s-%s "
                                    "attempt=%s/%s elapsed_seconds=%.6f",
                                    export_job_id,
                                    chunk_start,
                                    chunk_end - 1,
                                    attempt + 1,
                                    capture_attempts,
                                    time.perf_counter() - attempt_started,
                                )
                                if (
                                    attempt + 1 >= capture_attempts
                                    or not _looks_like_browser_disconnect(exc)
                                ):
                                    break
                                await progress_callback(
                                    "capturing",
                                    _capture_progress(chunk_start, total_frames),
                                    "Retrying caption capture chunk",
                                )
                            finally:
                                await shutdown_renderer()
                        if chunk_error is not None:
                            await delete_range(chunk_start, chunk_end)
                            raise ExportStageError(
                                "frame_capture",
                                f"Caption capture failed for frames {chunk_start}-{chunk_end - 1} "
                                f"after {capture_attempts} attempts. Previously completed frames were preserved, "
                                "but the export could not continue.",
                                chunk_error,
                            ) from chunk_error
                        await progress_callback(
                            "capturing",
                            _capture_progress(chunk_end, total_frames),
                            f"Capturing captions: {chunk_end}/{total_frames}",
                        )

                missing = [str(path) for path in frame_paths if not path.is_file()]
                if missing:
                    raise ExportStageError(
                        "frame_capture",
                        f"Caption capture checkpoint is incomplete ({len(missing)} files missing).",
                    )

                capture_elapsed = time.perf_counter() - capture_started
                await shutdown_renderer()
                await progress_callback("encoding", 82, "Encoding video...")
                encoder = "h264_nvenc" if hardware_acceleration else "libx264"
                global_args = ["ffmpeg", "-y"]
                input_args: list[str] = []
                filter_and_map_args: list[str] = []
                output_codec_args = [
                    "-c:v",
                    encoder,
                    "-preset",
                    resolve_ffmpeg_preset(
                        hardware_acceleration,
                        fastest=is_captions_only,
                    ),
                ]
                output_args: list[str] = []
                source_input_index: int | None = None
                if plan is not None:
                    manifest_path = capture_root / "frames.ffconcat"
                    manifest_text = _build_ffconcat_manifest(
                        frame_paths,
                        [segment.duration_frames for segment in plan],
                        export_fps,
                    )
                    await asyncio.to_thread(
                        manifest_path.write_text,
                        manifest_text,
                        "utf-8",
                    )
                    if is_captions_only:
                        input_args.extend(
                            ["-f", "concat", "-safe", "0", "-i", str(manifest_path)]
                        )
                        if include_audio and media_exists:
                            source_input_index = 1
                            input_args.extend(["-i", video_path])
                        filter_and_map_args.extend(
                            ["-map", "0:v:0", "-vf", f"fps={export_fps}"]
                        )
                    else:
                        input_args.extend(
                            [
                                "-f",
                                "concat",
                                "-safe",
                                "0",
                                "-i",
                                str(manifest_path),
                                "-i",
                                video_path,
                            ]
                        )
                        source_input_index = 1
                        filter_and_map_args.extend(
                            [
                                "-filter_complex",
                                build_full_video_filter_graph(
                                    source_dimensions,
                                    overlay_capture_dimensions,
                                    (width, height),
                                    source_input=1,
                                    overlay_input=0,
                                ),
                                "-map",
                                "[out]",
                                "-r",
                                str(export_fps),
                            ]
                        )
                elif is_captions_only:
                    input_args.extend(
                        [
                            "-framerate",
                            str(export_fps),
                            "-start_number",
                            "0",
                            "-i",
                            str(capture_root / "frame_%06d.png"),
                        ]
                    )
                    if include_audio and media_exists:
                        source_input_index = 1
                        input_args.extend(["-i", video_path])
                    filter_and_map_args.extend(["-map", "0:v:0"])
                else:
                    input_args.extend(
                        [
                            "-framerate",
                            str(export_fps),
                            "-start_number",
                            "0",
                            "-i",
                            str(capture_root / "frame_%06d.png"),
                            "-i",
                            video_path,
                        ]
                    )
                    source_input_index = 1
                    filter_and_map_args.extend(
                        [
                            "-filter_complex",
                            build_full_video_filter_graph(
                                source_dimensions,
                                overlay_capture_dimensions,
                                (width, height),
                                source_input=1,
                                overlay_input=0,
                            ),
                            "-map",
                            "[out]",
                        ]
                    )

                output_codec_args.extend(["-threads", str(ffmpeg_threads)])
                if video_bitrate:
                    output_codec_args.extend(["-b:v", video_bitrate])
                else:
                    output_codec_args.extend(
                        ["-cq" if hardware_acceleration else "-crf", crf]
                    )
                if (
                    include_audio
                    and media_exists
                    and source_input_index is not None
                ):
                    filter_and_map_args.extend(
                        ["-map", f"{source_input_index}:a?"]
                    )
                    output_codec_args.extend(["-c:a", "copy"])
                else:
                    output_codec_args.append("-an")
                output_args.extend(
                    [
                        "-t",
                        f"{duration:.9f}",
                        "-pix_fmt",
                        "yuv420p",
                        "-movflags",
                        "+faststart",
                        output_path,
                    ]
                )
                ffmpeg_cmd = (
                    global_args
                    + input_args
                    + filter_and_map_args
                    + output_codec_args
                    + output_args
                )
                _assert_ffmpeg_output_options_after_inputs(ffmpeg_cmd)
                _log_export_event(
                    "checkpointed_ffmpeg_encode_started",
                    exportJobId=export_job_id,
                    command=" ".join(ffmpeg_cmd),
                    captures=required_captures,
                    captureSeconds=round(capture_elapsed, 6),
                    totalElapsedSeconds=round(
                        time.perf_counter() - render_started_at,
                        6,
                    ),
                )
                encode_started = time.perf_counter()
                proc = await asyncio.create_subprocess_exec(
                    *ffmpeg_cmd,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _stdout, stderr = await proc.communicate()
                encode_elapsed = time.perf_counter() - encode_started
                if plan is not None:
                    performance.sparse_encode_seconds += encode_elapsed
                else:
                    performance.ffmpeg_finalize_seconds += encode_elapsed
                if proc.returncode != 0:
                    stderr_text = stderr.decode(errors="replace")
                    logger.error(
                        "checkpointed_ffmpeg_encode_failed export_job_id=%s exit=%s stderr=%s",
                        export_job_id,
                        proc.returncode,
                        _tail(stderr_text),
                    )
                    raise ExportStageError(
                        "ffmpeg_encode",
                        "FFmpeg could not encode the exported frames. "
                        f"{_useful_ffmpeg_error(stderr_text)}".strip(),
                    )
                output = Path(output_path)
                if not output.is_file() or output.stat().st_size <= 0:
                    raise ExportStageError(
                        "output_validation",
                        "FFmpeg did not create a non-empty MP4.",
                    )
                await progress_callback("finalizing", 98, "Finalizing export...")
                await progress_callback("export_complete", 100, "Done!")
                await emit_performance_summary()
                _log_export_event(
                    "checkpointed_export_complete",
                    exportJobId=export_job_id,
                    captureSeconds=round(capture_elapsed, 6),
                    encodeSeconds=round(encode_elapsed, 6),
                    totalSeconds=round(
                        time.perf_counter() - render_started_at,
                        6,
                    ),
                )
                return output_path
            finally:
                await shutdown_renderer()
                await asyncio.to_thread(shutil.rmtree, capture_root, True)

        return await run_checkpointed_export()

        async def run_sparse_export() -> str:
            plan_started = time.perf_counter()
            plan = build_sparse_caption_render_plan(
                parsed_captions,
                export_fps,
                theme,
                parsed_style_config,
                duration,
            )
            performance.sparse_plan_seconds += time.perf_counter() - plan_started
            frame_reduction_percent = (
                (1 - len(plan) / total_frames) * 100 if total_frames > 0 else 0.0
            )
            minimum_reduction_percent = max(
                0.0,
                _float_env("EXPORT_SPARSE_MIN_FRAME_REDUCTION_PERCENT", 30.0),
            )
            if frame_reduction_percent < minimum_reduction_percent:
                raise ExportStageError(
                    "sparse_plan",
                    "Sparse render plan would reduce captures by only "
                    f"{frame_reduction_percent:.2f}% (minimum "
                    f"{minimum_reduction_percent:.2f}%); using full-frame fallback.",
                )
            performance.render_engine = RenderEngine.BROWSER_SPARSE.value
            sparse_dir = Path(
                tempfile.mkdtemp(
                    prefix=f"capinsta_sparse_{job_id}_", dir=str(TEMP_DIR)
                )
            )
            frame_paths: list[Path] = []
            try:
                capture_started = time.perf_counter()
                for index, segment in enumerate(plan):
                    data = None
                    last_disconnect: Exception | None = None
                    for recovery_attempt in range(browser_recovery_attempts + 1):
                        try:
                            if page is None:
                                raise ExportStageError("frame_capture", "Sparse renderer page is unavailable.")
                            advance_started = time.perf_counter()
                            advanced = await page.evaluate(
                                "(frame) => window.setCaptionFrame(frame)",
                                segment.capture_frame,
                            )
                            performance.frame_advance_seconds += time.perf_counter() - advance_started
                            if advanced is not True:
                                raise ExportStageError(
                                    "frame_capture",
                                    f"Sparse renderer rejected frame {segment.capture_frame}.",
                                )
                            data = await timed_capture_render_frame()
                            break
                        except Exception as exc:
                            if not _looks_like_browser_disconnect(exc):
                                raise
                            last_disconnect = exc
                            if recovery_attempt >= browser_recovery_attempts:
                                break
                            await progress_callback(
                                "capturing",
                                5 + int((index / max(1, len(plan))) * 72),
                                f"Renderer disconnected; recovering at timeline frame {segment.capture_frame + 1}/{total_frames}...",
                            )
                            await recreate_render_page(
                                segment.time_seconds,
                                exc,
                                segment.capture_frame,
                            )
                    if data is None:
                        logger.error(
                            "sparse_renderer_recovery_exhausted export_job_id=%s frame=%s attempts=%s raw_error=%r",
                            export_job_id,
                            segment.capture_frame,
                            browser_recovery_attempts,
                            last_disconnect,
                        )
                        raise ExportStageError(
                            "frame_capture",
                            "The headless renderer disconnected during frame capture and could not be "
                            f"recovered after {browser_recovery_attempts} attempts. "
                            f"Last completed frame: {segment.start_frame}/{total_frames}.",
                            last_disconnect,
                        )
                    frame_path = sparse_dir / f"frame_{index:06d}.png"
                    await asyncio.to_thread(frame_path.write_bytes, data)
                    frame_paths.append(frame_path)
                    capture_pct = 5 + int(((index + 1) / max(1, len(plan))) * 72)
                    if index == 0 or index == len(plan) - 1 or index % max(1, len(plan) // 20) == 0:
                        _log_export_event(
                            "export_capture_progress",
                            exportJobId=export_job_id,
                            currentFrame=segment.end_frame_exclusive,
                            timelineFrames=total_frames,
                            uniqueCaptures=index + 1,
                            reusedFrames=max(0, segment.end_frame_exclusive - (index + 1)),
                            browserRecoveries=performance.browser_recoveries,
                            captureElapsedSeconds=round(time.perf_counter() - capture_started, 3),
                            peakProcessMemoryMb=_peak_process_memory_mb(),
                        )
                        await progress_callback(
                            "capturing",
                            min(77, capture_pct),
                            f"Capturing captions: {index + 1}/{len(plan)} unique states "
                            f"({segment.end_frame_exclusive}/{total_frames} timeline frames).",
                        )
                performance.sparse_capture_seconds += time.perf_counter() - capture_started

                await progress_callback("encoding", 80, "Encoding video from captured caption states...")
                manifest_path = sparse_dir / "frames.ffconcat"
                manifest_lines = ["ffconcat version 1.0"]
                for frame_path, segment in zip(frame_paths, plan):
                    normalized_path = frame_path.resolve().as_posix().replace("'", "'\\''")
                    manifest_lines.append(f"file '{normalized_path}'")
                    manifest_lines.append(f"duration {segment.duration_frames / export_fps:.9f}")
                final_path = frame_paths[-1].resolve().as_posix().replace("'", "'\\''")
                manifest_lines.append(f"file '{final_path}'")
                await asyncio.to_thread(
                    manifest_path.write_text,
                    "\n".join(manifest_lines) + "\n",
                    "utf-8",
                )

                encoder = "h264_nvenc" if hardware_acceleration else "libx264"
                sparse_cmd = ["ffmpeg", "-y"]
                if is_captions_only:
                    sparse_cmd.extend(["-f", "concat", "-safe", "0", "-i", str(manifest_path)])
                    if include_audio and media_exists:
                        sparse_cmd.extend(["-i", video_path])
                    sparse_cmd.extend([
                        "-map", "0:v:0",
                        "-vf", f"fps={export_fps}",
                        "-c:v", encoder,
                        "-preset", resolve_ffmpeg_preset(hardware_acceleration, fastest=True),
                    ])
                    audio_input = "1:a?"
                else:
                    sparse_cmd.extend([
                        "-i", video_path,
                        "-f", "concat", "-safe", "0", "-i", str(manifest_path),
                    ])
                    sparse_filter = build_full_video_filter_graph(
                        source_dimensions,
                        overlay_capture_dimensions,
                        (width, height),
                    )
                    sparse_cmd.extend([
                        "-filter_complex", sparse_filter,
                        "-map", "[out]",
                        "-r", str(export_fps),
                        "-c:v", encoder,
                        "-preset", resolve_ffmpeg_preset(hardware_acceleration, fastest=False),
                    ])
                    audio_input = "0:a?"
                    logger.info("export_sparse_filter_graph export_job_id=%s graph=%s", export_job_id, sparse_filter)
                sparse_cmd.extend(["-threads", str(ffmpeg_threads)])
                if video_bitrate:
                    sparse_cmd.extend(["-b:v", video_bitrate])
                else:
                    sparse_cmd.extend(["-cq" if hardware_acceleration else "-crf", crf])
                if include_audio and media_exists:
                    sparse_cmd.extend(["-map", audio_input, "-c:a", "copy"])
                else:
                    sparse_cmd.append("-an")
                sparse_cmd.extend([
                    "-t", f"{duration:.9f}",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    output_path,
                ])
                _log_export_event(
                    "sparse_ffmpeg_encode_started",
                    exportJobId=export_job_id,
                    command=" ".join(sparse_cmd),
                    legacyFrames=total_frames,
                    capturedFrames=len(plan),
                )
                encode_started = time.perf_counter()
                proc = await asyncio.create_subprocess_exec(
                    *sparse_cmd,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _stdout, stderr = await proc.communicate()
                performance.sparse_encode_seconds += time.perf_counter() - encode_started
                if proc.returncode != 0:
                    raise ExportStageError(
                        "ffmpeg_encode",
                        f"Sparse FFmpeg failed (exit {proc.returncode}): {_tail(stderr.decode(errors='replace'))}",
                    )
                if not Path(output_path).is_file() or Path(output_path).stat().st_size <= 0:
                    raise ExportStageError("output_validation", "Sparse FFmpeg did not create a non-empty MP4.")
                await progress_callback("finalizing", 98, "Finalizing export...")
                await shutdown_renderer()
                await progress_callback("export_complete", 100, "Done!")
                await emit_performance_summary()
                return output_path
            except Exception as sparse_error:
                try:
                    Path(output_path).unlink(missing_ok=True)
                except OSError:
                    pass
                if not (
                    isinstance(sparse_error, ExportStageError)
                    and sparse_error.stage == "sparse_plan"
                ):
                    await shutdown_renderer()
                raise
            finally:
                await asyncio.to_thread(shutil.rmtree, sparse_dir, True)

        if selected_engine is RenderEngine.BROWSER_SPARSE:
            try:
                return await run_sparse_export()
            except Exception as sparse_exc:
                if not (
                    isinstance(sparse_exc, ExportStageError)
                    and sparse_exc.stage == "sparse_plan"
                ):
                    raise
                logger.info(
                    "sparse_render_fallback export_job_id=%s reason=%s: %s",
                    export_job_id,
                    type(sparse_exc).__name__,
                    sparse_exc,
                )
                performance.render_engine = RenderEngine.BROWSER_FULL_FRAME.value

        if is_captions_only and _bool_env("EXPORT_LEGACY_CAPTIONS_ONLY_DISK_PIPELINE", False):
            chunk_size = max(30, _int_env("EXPORT_CAPTIONS_ONLY_CHUNK_FRAMES", 240))
            chunk_retries = max(1, _int_env("EXPORT_CAPTIONS_ONLY_CHUNK_RETRIES", 3))
            frame_dir = Path(
                tempfile.mkdtemp(
                    prefix=f"huygen_frames_{job_id}_", dir=str(TEMP_DIR)
                )
            )

            async def delete_chunk_frames(start_frame: int, end_frame: int) -> None:
                def _delete() -> None:
                    for delete_idx in range(start_frame, end_frame):
                        try:
                            (frame_dir / f"frame_{delete_idx:06d}.png").unlink(missing_ok=True)
                        except OSError:
                            pass

                await asyncio.to_thread(_delete)

            async def write_frame(frame_number: int, data: bytes) -> None:
                path = frame_dir / f"frame_{frame_number:06d}.png"
                write_started = time.perf_counter()
                await asyncio.to_thread(path.write_bytes, data)
                performance.captions_only_png_disk_write_seconds += time.perf_counter() - write_started

            async def capture_chunk(start_frame: int, end_frame: int, attempt: int) -> None:
                nonlocal page
                start_time = start_frame / export_fps
                if _should_recreate_captions_chunk(attempt):
                    await recreate_render_page(
                        start_time,
                        ExportStageError("frame_capture", f"Retrying captions-only chunk {start_frame}-{end_frame - 1}."),
                        start_frame,
                    )
                for current_frame in range(start_frame, end_frame):
                    if page is None:
                        raise ExportStageError("frame_capture", "Render page is not available.")
                    advance_started = time.perf_counter()
                    advanced = await page.evaluate(
                        "(frame) => window.setCaptionFrame(frame)",
                        current_frame,
                    )
                    performance.frame_advance_seconds += time.perf_counter() - advance_started
                    if advanced is not True:
                        raise ExportStageError(
                            "frame_capture",
                            f"Caption renderer rejected frame {current_frame}.",
                        )
                    if current_frame % 30 == 0:
                        frame_info = await page.evaluate(
                            "() => window.__CAPSTA_ACTIVE_FRAME_INFO__ || null"
                        )
                        logger.info(
                            "[captions-only frame] frame=%s timeSec=%.3f activeCaptionText=%r activeWordText=%r",
                            current_frame,
                            current_frame / export_fps,
                            frame_info.get("captionText") if isinstance(frame_info, dict) else None,
                            frame_info.get("activeWordId") if isinstance(frame_info, dict) else None,
                        )
                    await write_frame(current_frame, await timed_capture_render_frame())

            try:
                last_pct = 5
                for chunk_start in range(0, total_frames, chunk_size):
                    chunk_end = min(total_frames, chunk_start + chunk_size)
                    chunk_error: Exception | None = None
                    for attempt in range(chunk_retries):
                        try:
                            await progress_callback(
                                "exporting",
                                last_pct,
                                f"Capturing caption frames {chunk_start + 1}-{chunk_end}/{total_frames}...",
                            )
                            await capture_chunk(chunk_start, chunk_end, attempt)
                            chunk_error = None
                            break
                        except Exception as exc:
                            chunk_error = exc
                            await delete_chunk_frames(chunk_start, chunk_end)
                            await close_page_safely()
                            if attempt < chunk_retries - 1:
                                await progress_callback(
                                    "exporting",
                                    last_pct,
                                    f"Renderer restarted for captions-only frame {chunk_start + 1}; retrying chunk...",
                                )
                    if chunk_error:
                        logs = _tail("\n".join(page_logs), 1600)
                        detail = (
                            f"Caption frame capture failed at frame {chunk_start + 1} after retries. "
                            "Check render page console logs."
                        )
                        if logs:
                            detail = f"{detail} Render logs: {logs}"
                        raise ExportStageError("frame_capture", detail, chunk_error) from chunk_error
                    pct = 5 + int((chunk_end / total_frames) * 75)
                    if pct > last_pct:
                        last_pct = pct
                        await progress_callback("exporting", pct, f"Captured {chunk_end}/{total_frames} caption frames.")

                await progress_callback("encoding", 82, "Encoding captions-only MP4...")

                encoder = "h264_nvenc" if hardware_acceleration else "libx264"
                ffmpeg_cmd = [
                    "ffmpeg", "-y",
                    "-f", "lavfi", "-r", str(export_fps), "-i", f"color=c={safe_bg}:s={width}x{height}:d={duration:.6f}",
                    "-framerate", str(export_fps), "-start_number", "0", "-i", str(frame_dir / "frame_%06d.png"),
                ]
                if include_audio and media_exists:
                    ffmpeg_cmd.extend(["-i", video_path])
                ffmpeg_cmd.extend([
                    "-filter_complex",
                    "[1:v]format=rgba[ov];[0:v][ov]overlay=0:0:format=auto:eof_action=pass:shortest=0[out]",
                    "-map", "[out]",
                    "-c:v", encoder,
                    "-preset", resolve_ffmpeg_preset(hardware_acceleration, fastest=True),
                ])
                if ffmpeg_threads:
                    ffmpeg_cmd.extend(["-threads", str(ffmpeg_threads)])
                if video_bitrate:
                    ffmpeg_cmd.extend(["-b:v", video_bitrate])
                else:
                    ffmpeg_cmd.extend(["-cq" if hardware_acceleration else "-crf", crf])
                if include_audio and media_exists:
                    ffmpeg_cmd.extend(["-map", "2:a?", "-c:a", "aac", "-b:a", "192k"])
                else:
                    ffmpeg_cmd.append("-an")
                ffmpeg_cmd.extend([
                    "-t",
                    f"{duration:.6f}",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    output_path,
                ])

                _log_export_event(
                    "captions_only_ffmpeg_encode_started",
                    exportJobId=export_job_id,
                    command=" ".join(ffmpeg_cmd),
                    frameDir=str(frame_dir),
                    totalFrames=total_frames,
                )
                captions_encode_started = time.perf_counter()
                proc = await asyncio.create_subprocess_exec(
                    *ffmpeg_cmd,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _out, err = await proc.communicate()
                performance.captions_only_ffmpeg_encode_seconds += time.perf_counter() - captions_encode_started
                if proc.returncode != 0:
                    stderr_text = _tail(err.decode(errors="replace"))
                    raise ExportStageError(
                        "ffmpeg_encode",
                        f"FFmpeg failed while encoding captions-only MP4 (exit {proc.returncode}). {stderr_text}".strip(),
                    )
                if not os.path.exists(output_path):
                    raise ExportStageError("output_validation", "FFmpeg finished but the output file was not created.")
                output_size = os.path.getsize(output_path)
                if output_size <= 0:
                    raise ExportStageError("output_validation", "FFmpeg created an empty output file.")

                await progress_callback("finalizing", 98, "Finalizing export...")
                await shutdown_renderer()
                await progress_callback("export_complete", 100, "Done!")
                await emit_performance_summary()
                _log_export_event(
                    "export_job_complete",
                    exportJobId=export_job_id,
                    outputFile=Path(output_path).name,
                    bytes=output_size,
                    elapsedSeconds=round(time.perf_counter() - render_started_at, 3),
                )
                return output_path
            finally:
                await shutdown_renderer()
                try:
                    shutil.rmtree(frame_dir, ignore_errors=True)
                except Exception:
                    pass

        encoder = "h264_nvenc" if hardware_acceleration else "libx264"
        ffmpeg_cmd = ["ffmpeg", "-y"]
        safe_bg = _ffmpeg_color(background_color, fallback="#00ff00" if is_captions_only else "#101010")
        if is_captions_only:
            # Input 0: full-duration solid canvas. Input 1: piped transparent caption frames.
            # Optional input 2: source media for audio only.
            ffmpeg_cmd.extend([
                "-f", "lavfi", "-r", str(export_fps), "-i", f"color=c={safe_bg}:s={width}x{height}:d={duration:.6f}",
                "-f", "image2pipe", "-framerate", str(export_fps), "-c:v", "png", "-i", "pipe:0",
            ])
            if include_audio:
                ffmpeg_cmd.extend(["-i", video_path])
            ffmpeg_cmd.extend([
                "-filter_complex",
                "[1:v]format=rgba[ov];[0:v][ov]overlay=0:0:eof_action=pass:shortest=0[out]",
                "-map", "[out]",
                "-c:v", encoder,
                "-preset", resolve_ffmpeg_preset(hardware_acceleration, fastest=True),
            ])
            if ffmpeg_threads:
                ffmpeg_cmd.extend(["-threads", str(ffmpeg_threads)])
            if video_bitrate:
                ffmpeg_cmd.extend(["-b:v", video_bitrate])
            else:
                ffmpeg_cmd.extend(["-cq" if hardware_acceleration else "-crf", crf])
            if include_audio:
                ffmpeg_cmd.extend(["-map", "2:a?", "-c:a", "copy"])
            else:
                ffmpeg_cmd.append("-an")
            ffmpeg_cmd.extend(
                [
                    "-t",
                    f"{duration:.6f}",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    output_path,
                ]
            )
        else:
            # OVERLAY PIPELINE: original video + transparent caption frames.
            # Input 0: original source video (preserves quality, has audio track).
            # Input 1: piped transparent PNG caption overlay frames from browser.
            # FFmpeg composites: video at base, captions overlaid at (0,0).
            ffmpeg_cmd.extend([
                "-i", video_path,                                          # Input 0: original video
                "-f", "image2pipe", "-framerate", str(export_fps), "-c:v", "png",
                "-i", "pipe:0",                                             # Input 1: transparent caption PNGs
            ])
            # Scale BOTH the original video (input 0) AND the caption overlay
            # (input 1, which is rendered at the project canvas size by /render)
            # to the target export resolution before compositing. This guarantees
            # the overlay matches the video frame pixel-for-pixel regardless of
            # whether the source video, the project canvas, and the export
            # resolution all differ. Both are scaled to exactly (width, height).
            overlay_filter = build_full_video_filter_graph(
                source_dimensions,
                overlay_capture_dimensions,
                (width, height),
            )
            logger.info(
                "export_filter_graph export_job_id=%s source=%s overlay=%s output=%sx%s graph=%s",
                export_job_id,
                source_dimensions,
                overlay_capture_dimensions,
                width,
                height,
                overlay_filter,
            )
            ffmpeg_cmd.extend([
                "-filter_complex",
                overlay_filter,
                "-map", "[out]",
                "-c:v", encoder,
                "-preset", resolve_ffmpeg_preset(hardware_acceleration, fastest=False),
            ])
            if ffmpeg_threads:
                ffmpeg_cmd.extend(["-threads", str(ffmpeg_threads)])
            if video_bitrate:
                ffmpeg_cmd.extend(["-b:v", video_bitrate])
            else:
                ffmpeg_cmd.extend(["-cq" if hardware_acceleration else "-crf", crf])
            # Audio comes from input 0 (original video) — copy without re-encode.
            if include_audio and media_exists:
                ffmpeg_cmd.extend(["-map", "0:a?", "-c:a", "copy"])
            else:
                ffmpeg_cmd.append("-an")
            ffmpeg_cmd.extend([
                "-t", f"{duration:.6f}",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                output_path,
            ])

        _log_export_event(
            "ffmpeg_encode_started",
            exportJobId=export_job_id,
            command=" ".join(ffmpeg_cmd),
        )

        ffmpeg_started_at = time.perf_counter()
        try:
            ffmpeg_proc = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
        except Exception as exc:
            raise ExportStageError("ffmpeg_start", f"FFmpeg could not start: {exc}", exc) from exc

        async def drain_stderr() -> None:
            if not ffmpeg_proc or not ffmpeg_proc.stderr:
                return
            while True:
                chunk = await ffmpeg_proc.stderr.read(4096)
                if not chunk:
                    break
                stderr_chunks.append(chunk)
                if sum(len(part) for part in stderr_chunks) > 20000:
                    joined = b"".join(stderr_chunks)[-12000:]
                    stderr_chunks.clear()
                    stderr_chunks.append(joined)

        stderr_task = asyncio.create_task(drain_stderr())
        ffmpeg_stdin_closed = False

        async def close_ffmpeg_stdin_once() -> None:
            nonlocal ffmpeg_stdin_closed
            if ffmpeg_stdin_closed:
                return
            ffmpeg_stdin_closed = True
            if ffmpeg_proc and ffmpeg_proc.stdin:
                try:
                    ffmpeg_proc.stdin.close()
                    wait_closed = getattr(ffmpeg_proc.stdin, "wait_closed", None)
                    if wait_closed:
                        await wait_closed()
                except Exception:
                    pass

        # Capture frames
        last_pct = 5
        frame_idx = 0
        last_completed_frame = -1
        frame_stream_error: Exception | None = None
        frame_capture_started = time.perf_counter()
        try:
            for frame_idx in range(total_frames):
                current_time = frame_idx / export_fps
                if ffmpeg_proc.returncode is not None:
                    raise ExportStageError(
                        "ffmpeg_stream",
                        f"FFmpeg exited before timeline frame {frame_idx + 1}/{total_frames}.",
                    )

                # Page recycling is needed for WebGL stability (legacy mode) but
                # unnecessary for overlay-only mode (pure React DOM, no GPU state).
                if not is_captions_only and _should_schedule_page_recycle(frame_idx, render_page_recycle_frames):
                    await progress_callback(
                        "exporting",
                        last_pct,
                        f"Refreshing renderer at frame {frame_idx + 1}/{total_frames} to keep export stable...",
                    )
                    await recreate_render_page(
                        current_time,
                        ExportStageError("frame_capture", f"Scheduled renderer refresh after {render_page_recycle_frames} frames."),
                    )

                screenshot_bytes = None
                last_frame_error: Exception | None = None
                for attempt in range(browser_recovery_attempts + 1):
                    try:
                        if page is None:
                            raise ExportStageError("frame_capture", "Render page is not available.")

                        # Set the caption time in the render page. The page resolves
                        # after React has committed the frame.
                        advance_started = time.perf_counter()
                        await page.evaluate("(time) => window.setCaptionTime(time)", current_time)
                        performance.frame_advance_seconds += time.perf_counter() - advance_started

                        # Assert no debug/instrumentation overlays are visible before
                        # capturing. This catches React Scan badges, Next.js dev
                        # portals, FPS widgets, etc. before they leak into frames.
                        try:
                            clean_check = (
                                await page.evaluate("() => (typeof window.assertExportClean === 'function' ? window.assertExportClean() : { ok: true, debugOverlaysFound: 0 })")
                                if _should_run_clean_check(frame_idx, clean_check_interval_frames)
                                else {"ok": True, "debugOverlaysFound": 0}
                            )
                            if isinstance(clean_check, dict) and not clean_check.get("ok", True):
                                reason = clean_check.get("reason") or "debug overlay visible"
                                found = clean_check.get("debugOverlaysFound", 0)
                                if frame_idx == 0:
                                    logger.error("export_blocked_debug_overlay frame=0 reason=%s found=%d — aborting export", reason, found)
                                    raise ExportStageError("frame_capture", f"Export blocked: debug/inspector overlay visible ({found} found). Reason: {reason}")
                                else:
                                    logger.warning("export_debug_overlay_visible frame=%d found=%d reason=%s — scrubber will retry removal", frame_idx, found, reason)
                        except ExportStageError:
                            raise
                        except Exception as clean_exc:
                            logger.debug("assertExportClean check failed (non-fatal): %s", clean_exc)

                        screenshot_bytes = await timed_capture_render_frame()

                        # Log frame diagnostics at key checkpoints.
                        if frame_idx in {0, 30, 60, 90}:
                            frame_size = len(screenshot_bytes) if screenshot_bytes else 0
                            try:
                                info = await page.evaluate("() => window.__CAPSTA_ACTIVE_FRAME_INFO__")
                                if info:
                                    logger.info(
                                        "export_frame_sync frame=%d frameTime=%.3f size=%dB activeCaptionId=%s activeWordId=%s captionText=%s",
                                        frame_idx,
                                        current_time,
                                        frame_size,
                                        info.get("activeCaptionId"),
                                        info.get("activeWordId"),
                                        info.get("captionText"),
                                    )
                                else:
                                    logger.info("export_frame_sync frame=%d frameTime=%.3f size=%dB activeCaptionId=none", frame_idx, current_time, frame_size)
                            except Exception as eval_exc:
                                logger.warning("Failed to evaluate active frame info at frame %s: %s", frame_idx, eval_exc)

                        break
                    except Exception as frame_exc:
                        last_frame_error = frame_exc
                        if not _looks_like_browser_disconnect(frame_exc):
                            break
                        if attempt >= browser_recovery_attempts:
                            break
                        await progress_callback(
                            "capturing",
                            last_pct,
                            f"Renderer disconnected; recovering at frame {frame_idx + 1}/{total_frames}...",
                        )
                        await recreate_render_page(current_time, frame_exc)

                if screenshot_bytes is None:
                    if last_frame_error:
                        if _looks_like_browser_disconnect(last_frame_error):
                            logger.error(
                                "renderer_recovery_exhausted export_job_id=%s frame=%s attempts=%s raw_error=%r",
                                export_job_id,
                                frame_idx,
                                browser_recovery_attempts,
                                last_frame_error,
                            )
                            raise ExportStageError(
                                "frame_capture",
                                "The headless renderer disconnected during frame capture and could not be "
                                f"recovered after {browser_recovery_attempts} attempts. "
                                f"Last completed frame: {max(0, last_completed_frame + 1)}/{total_frames}.",
                                last_frame_error,
                            )
                        raise last_frame_error
                    raise ExportStageError("frame_capture", "Frame capture returned no image bytes.")

                # Write PNG bytes to FFmpeg stdin
                if ffmpeg_proc.stdin:
                    try:
                        ffmpeg_proc.stdin.write(screenshot_bytes)
                        drain_started = time.perf_counter()
                        await ffmpeg_proc.stdin.drain()
                        performance.record_ffmpeg_drain(time.perf_counter() - drain_started)
                    except (BrokenPipeError, ConnectionResetError) as exc:
                        raise ExportStageError(
                            "ffmpeg_stream",
                            f"FFmpeg stopped accepting PNG frame {frame_idx + 1}/{total_frames}.",
                            exc,
                        ) from exc
                last_completed_frame = frame_idx

                # Progress update (throttle to every 2%)
                pct = 5 + int(((frame_idx + 1) / total_frames) * 77)  # 5% to 82%
                if pct >= last_pct + 2:
                    last_pct = pct
                    if pct % 10 <= 1:
                        _log_export_event(
                            "export_capture_progress",
                            exportJobId=export_job_id,
                            currentFrame=frame_idx + 1,
                            timelineFrames=total_frames,
                            uniqueCaptures=performance.captured_frames,
                            reusedFrames=0,
                            browserRecoveries=performance.browser_recoveries,
                            captureElapsedSeconds=round(time.perf_counter() - frame_capture_started, 3),
                            peakProcessMemoryMb=_peak_process_memory_mb(),
                        )
                    await progress_callback(
                        "capturing", pct,
                        f"Capturing captions: frame {frame_idx + 1}/{total_frames}"
                    )

        except Exception as e:
            frame_stream_error = e
            await close_ffmpeg_stdin_once()
            logger.exception("Frame capture error at frame %s", frame_idx)
        finally:
            # Close FFmpeg stdin and wait for it to finish
            if frame_stream_error is None:
                await progress_callback("encoding", 90, "Encoding remaining video frames...")
            await close_ffmpeg_stdin_once()

            finalize_started = time.perf_counter()
            if ffmpeg_proc:
                await ffmpeg_proc.wait()
            await stderr_task
            performance.ffmpeg_finalize_seconds += time.perf_counter() - finalize_started
            if is_captions_only:
                performance.captions_only_ffmpeg_encode_seconds += time.perf_counter() - ffmpeg_started_at
            if frame_stream_error is None:
                await progress_callback("finalizing", 98, "Finalizing export...")

        if frame_stream_error is not None:
            await shutdown_renderer()
            try:
                Path(output_path).unlink(missing_ok=True)
            except OSError:
                pass
            if isinstance(frame_stream_error, ExportStageError):
                raise frame_stream_error
            raise ExportStageError(
                "frame_capture",
                str(frame_stream_error),
                frame_stream_error,
            ) from frame_stream_error

        # Check FFmpeg result
        if ffmpeg_proc.returncode != 0:
            stderr_text = _tail(b"".join(stderr_chunks).decode(errors="replace"))
            logger.error("FFmpeg failed (exit %s): %s", ffmpeg_proc.returncode, stderr_text)
            await shutdown_renderer()
            try:
                Path(output_path).unlink(missing_ok=True)
            except OSError:
                pass
            raise ExportStageError(
                "ffmpeg_encode",
                f"FFmpeg failed while encoding the MP4 (exit {ffmpeg_proc.returncode}). {stderr_text}".strip(),
            )

        if not os.path.exists(output_path):
            await shutdown_renderer()
            raise ExportStageError("output_validation", "FFmpeg finished but the output file was not created.")
        output_size = os.path.getsize(output_path)
        if output_size <= 0:
            await shutdown_renderer()
            raise ExportStageError("output_validation", "FFmpeg created an empty output file.")

        await shutdown_renderer()
        await progress_callback("export_complete", 100, "Done!")
        await emit_performance_summary()
        _log_export_event(
            "export_job_complete",
            exportJobId=export_job_id,
            outputFile=Path(output_path).name,
            bytes=output_size,
            elapsedSeconds=round(time.perf_counter() - render_started_at, 3),
        )

    return output_path
