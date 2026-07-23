import os
import sys
import asyncio
from dotenv import load_dotenv
import logging

# 1. Load context and Inject FFmpeg into PATH immediately
# This MUST happen before any AI pipeline modules are imported
load_dotenv()
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

if sys.platform == "win32":
    current_policy = asyncio.get_event_loop_policy()
    if not isinstance(current_policy, asyncio.WindowsProactorEventLoopPolicy):
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        sys.stdout.write("INFO: Windows asyncio policy set to Proactor for export subprocess support\n")

ffmpeg_exe = os.getenv("FFMPEG_PATH")
if ffmpeg_exe and os.path.exists(ffmpeg_exe):
    ffmpeg_bin = os.path.dirname(ffmpeg_exe)
    if ffmpeg_bin not in os.environ["PATH"]:
        os.environ["PATH"] = ffmpeg_bin + os.pathsep + os.environ["PATH"]
        sys.stdout.write(f"INFO: Global FFmpeg injection successful: {ffmpeg_bin}\n")

# 2. Add project root to path so `ai_pipeline` can be imported
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from contextlib import asynccontextmanager
import shutil
import uuid

# These imports will trigger ai_pipeline logic
from .database import init_db
from .project_cleanup import project_cleanup_loop, stop_cleanup_task
from .api import admin, captions, health, jobs, export_jobs, media_assets, projects
from .settings import cleanup_old_runtime_files, ensure_runtime_dirs, env_list, frontend_dist_available, FRONTEND_DIST_DIR, EXPORT_DIR, CAPTION_FONT_DIR, DB_PATH, validate_storage_startup
from .auth import (
    AuthBoundaryError,
    authenticate_request,
    log_auth_reject,
    request_token_metadata,
    reset_current_user,
    set_current_user,
    validate_auth_startup,
)
from .operational_mirror import deleted_project_records_available, operational_mirror_loop, stop_operational_mirror
from .storage_retention import (
    stop_storage_retention,
    storage_retention_loop,
)
from .runtime_policy import (
    ControlPlaneUnavailableError,
    InactiveAccountError,
    ProductAccessDeniedError,
    control_plane_health,
    control_plane_error_reason,
    require_active_account,
    require_backend_capability,
)
from .rate_limit import enforce_api_rate_limit
from .api_versioning import canonical_api_path
from .request_limits import evaluate_request_body_limit

logger = logging.getLogger(__name__)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


def _public_error_message(status_code: int, detail) -> tuple[str, str]:
    if isinstance(detail, dict):
        code = str(detail.get("code") or "request_failed")
        message = str(detail.get("message") or detail.get("detail") or "Request failed.")
        return code, message
    if status_code == 400:
        return "bad_request", "The request could not be processed."
    if status_code == 401:
        return "unauthenticated", "Authentication is required."
    if status_code == 403:
        return "forbidden", "You do not have permission to perform this action."
    if status_code == 404:
        return "not_found", "The requested resource was not found."
    if status_code == 409:
        return "conflict", "The request conflicts with the current resource state."
    if status_code == 413:
        return "upload_too_large", "The request exceeds the configured upload limit."
    if status_code == 415:
        return "unsupported_media_type", "This file type is not supported."
    if status_code == 422:
        return "validation_failed", "The request failed validation."
    if status_code == 429:
        return "rate_limited", "Too many requests. Please try again later."
    if status_code == 503:
        return "temporarily_unavailable", "This service is temporarily unavailable."
    return "request_failed", "Request failed."


def _request_id(request: Request) -> str:
    return request.headers.get("x-request-id") or request.headers.get("x-correlation-id") or str(uuid.uuid4())


def _error_response(request: Request, status_code: int, detail, headers: dict[str, str] | None = None) -> JSONResponse:
    code, message = _public_error_message(status_code, detail)
    request_id = _request_id(request)
    public_context = {}
    if isinstance(detail, dict):
        for field in (
            "actualDurationSeconds",
            "allowedDurationSeconds",
            "actualBytes",
            "allowedBytes",
            "maxBytes",
            "usedMinutes",
            "requestedMinutes",
            "allowedMinutes",
            "activeJobs",
            "allowedJobs",
        ):
            value = detail.get(field)
            if isinstance(value, (int, float)):
                public_context[field] = value
    response = JSONResponse(
        {
            "error": {
                "code": code,
                "message": message,
                "requestId": request_id,
                **public_context,
            }
        },
        status_code=status_code,
        headers={**(headers or {}), "X-Request-ID": request_id},
    )
    return response


def _log_startup_operational_summary() -> None:
    try:
        from ai_pipeline.timing_presets import TIMING_PRESETS
        from .transcription_catalog import public_catalog

        catalog = public_catalog()
        logger.info(
            "backend_startup bind_host=%s port=%s api_prefix=%s readiness_route=%s "
            "db_path=%s provider_catalog_count=%s provider_models=%s "
            "preset_catalog_count=%s silero_check=%s stable_ts_check=%s",
            "0.0.0.0",
            os.getenv("PORT", "10000"),
            "/api",
            "/health/ready",
            DB_PATH,
            len(catalog),
            ",".join(
                sorted(f"{item.get('provider')}:{item.get('model')}" for item in catalog)
            ),
            len(TIMING_PRESETS),
            "deferred_to_health_timing",
            "deferred_to_health_timing",
        )
    except Exception as exc:
        logger.warning("backend_startup_summary_failed error=%s", exc)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize Database
    _log_startup_operational_summary()
    ensure_runtime_dirs()
    validate_storage_startup()
    await init_db()
    try:
        validate_auth_startup()
    except AuthBoundaryError as exc:
        log_auth_reject(exc)
    database_health = await control_plane_health()
    logger.info(
        "control_plane_status status=%s",
        database_health["controlPlaneDatabase"],
    )
    await deleted_project_records_available()
    recovered_exports = await export_jobs.recover_orphaned_export_jobs()
    if recovered_exports:
        logger.warning("export_jobs_recovered_orphaned count=%s", recovered_exports)
    removed = cleanup_old_runtime_files()
    if removed:
        logger.info("runtime_cleanup removed_files=%s", removed)
    cleanup_task = asyncio.create_task(project_cleanup_loop(), name="project-inactivity-cleanup")
    storage_retention_task = asyncio.create_task(
        storage_retention_loop(), name="storage-retention-cleanup"
    )
    mirror_task = asyncio.create_task(operational_mirror_loop(), name="operational-mirror")
    
    # Check for crucial runtime dependencies and API keys.
    from ai_pipeline.transcriber import is_real_secret

    stt_provider = os.getenv("STT_PROVIDER", "auto").strip() or "auto"
    gemini_key = is_real_secret(os.getenv("GEMINI_API_KEY")) or is_real_secret(os.getenv("GOOGLE_API_KEY"))
    groq_key = is_real_secret(os.getenv("GROQ_API_KEY"))
    openai_key = is_real_secret(os.getenv("OPENAI_API_KEY"))
    sarvam_key = is_real_secret(os.getenv("SARVAM_API_KEY"))
    if stt_provider == "auto" and not any([gemini_key, groq_key, openai_key, sarvam_key]):
        print("WARNING: No STT provider API key is configured. Caption generation will fail until a key is set.")
    if stt_provider == "gemini" and not gemini_key:
        print("WARNING: STT_PROVIDER=gemini requires GEMINI_API_KEY. Transcription will fail.")
    if stt_provider in {"whisper", "groq_whisper"} and not groq_key:
        print("WARNING: GROQ_API_KEY is not set or is still a placeholder. Transcription will fail.")
    if stt_provider == "sarvam" and not sarvam_key:
        print("WARNING: STT_PROVIDER=sarvam requires SARVAM_API_KEY. Transcription will fail.")
    if not shutil.which("ffmpeg"):
        print("WARNING: FFmpeg is not on PATH. Set FFMPEG_PATH or install FFmpeg.")
    if not shutil.which("ffprobe"):
        print("WARNING: FFprobe is not on PATH. Export and validation may fail.")
    try:
        from ai_pipeline.timing import alignment_provider_status

        timing_status = alignment_provider_status()
        if timing_status.get("stableTsEnabled"):
            logger.info(
                "stable_ts_startup_check importable=%s version=%s torch=%s torch_version=%s cuda=%s ffmpeg=%s ffprobe=%s device=%s cache_dir=%s cache_writable=%s unavailable=%s",
                timing_status.get("stableTsImportable"),
                timing_status.get("stableTsVersion") or "-",
                timing_status.get("torchAvailable"),
                timing_status.get("torchVersion") or "-",
                timing_status.get("torchCudaAvailable"),
                timing_status.get("ffmpegAvailable"),
                timing_status.get("ffprobeAvailable"),
                timing_status.get("configuredDevice"),
                timing_status.get("stableTsCacheDir"),
                timing_status.get("stableTsCacheWritable"),
                ",".join(timing_status.get("forcedAlignmentUnavailableReasons") or []),
            )
        if timing_status.get("sileroVadEnabled"):
            logger.info(
                "silero_vad_startup_check importable=%s version=%s torch=%s provider=%s degraded=%s unavailable=%s",
                timing_status.get("sileroVadImportable"),
                timing_status.get("sileroVadVersion") or "-",
                timing_status.get("torchAvailable"),
                timing_status.get("pauseDetectionProvider"),
                timing_status.get("pauseDetectionDegraded"),
                ",".join(timing_status.get("forcedAlignmentUnavailableReasons") or []),
            )
            from ai_pipeline.tools.silero_vad_smoke import run_smoke

            smoke = run_smoke()
            logger.info(
                "silero_vad_startup_smoke status=%s provider=%s degraded=%s duration=%s raw_speech_ranges=%s hard_gaps=%s",
                smoke.get("sileroVadSmoke"),
                smoke.get("pauseDetectionProvider"),
                smoke.get("pauseDetectionDegraded"),
                smoke.get("audioDuration"),
                smoke.get("rawSpeechRangeCount"),
                smoke.get("hardSpeechGapCount"),
            )
    except Exception as exc:
        logger.warning("timing_startup_check_failed error=%s", exc)
        if os.getenv("ENABLE_SILERO_VAD", "false").strip().lower() == "true":
            raise
    if frontend_dist_available():
        logger.info("frontend_static_enabled path=%s", FRONTEND_DIST_DIR)
    else:
        logger.info("frontend_static_missing path=%s local_dev_expected=true", FRONTEND_DIST_DIR)
        
    try:
        yield
    finally:
        await stop_cleanup_task(cleanup_task)
        await stop_storage_retention(storage_retention_task)
        await stop_operational_mirror()
        mirror_task.cancel()
        print("Shutting down the server...")


app = FastAPI(
    title="Huygen Caps",
    description="AI-powered short-form captioning engine for English, Hinglish, and Telgish",
    version="5.0.0",
    lifespan=lifespan
)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return _error_response(request, exc.status_code, exc.detail, dict(exc.headers or {}))


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning(
        "request_validation_failed path=%s method=%s request_id=%s errors=%s",
        request.url.path,
        request.method,
        _request_id(request),
        len(exc.errors()),
    )
    return _error_response(request, 422, {"code": "validation_failed", "message": "The request failed validation."})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    request_id = _request_id(request)
    logger.exception(
        "unhandled_request_error path=%s method=%s request_id=%s category=%s",
        request.url.path,
        request.method,
        request_id,
        type(exc).__name__,
    )
    return _error_response(request, 500, {"code": "internal_error", "message": "Internal server error."})


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    request_id = _request_id(request)
    response = await call_next(request)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    response.headers.setdefault("X-Request-ID", request_id)
    if os.getenv("NODE_ENV") == "production":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
    return response


@app.middleware("http")
async def enforce_request_body_limits(request: Request, call_next):
    decision = evaluate_request_body_limit(request)
    if not decision.allowed:
        logger.warning(
            "request_body_rejected path=%s method=%s received=%s limit=%s reason=%s request_id=%s",
            request.url.path,
            request.method,
            decision.received,
            decision.limit,
            decision.reason,
            _request_id(request),
        )
        return _error_response(
            request,
            413,
            {
                "code": "upload_too_large",
                "message": "The request exceeds the configured upload limit.",
                "actualBytes": decision.received,
                "allowedBytes": decision.limit,
            },
        )
    return await call_next(request)

PROTECTED_API_PREFIXES = (
    "/api/jobs",
    "/api/v1/jobs",
    "/api/export/jobs",
    "/api/v1/export/jobs",
    "/api/captions/jobs",
    "/api/v1/captions/jobs",
    "/api/media/assets",
    "/api/v1/media/assets",
    "/api/projects",
    "/api/v1/projects",
)


@app.middleware("http")
async def require_supabase_auth(request: Request, call_next):
    if not request.url.path.startswith(PROTECTED_API_PREFIXES):
        return await call_next(request)
    correlation_id = (
        request.headers.get("x-correlation-id") or str(uuid.uuid4())
    )
    try:
        user = authenticate_request(request)
        await require_active_account(user)
        await require_backend_capability(user, canonical_api_path(request.url.path))
        await enforce_api_rate_limit(request, user)
    except AuthBoundaryError as exc:
        algorithm, key_id = request_token_metadata(request)
        log_auth_reject(
            exc,
            request=request,
            algorithm=algorithm,
            key_id=key_id,
            correlation_id=correlation_id,
        )
        return JSONResponse(
            {"detail": exc.public_detail, "code": exc.public_code},
            status_code=exc.status_code,
            headers={"X-Correlation-ID": correlation_id},
        )
    except InactiveAccountError as exc:
        logger.warning(
            "auth_reject reason=%s method=%s path=%s correlation_id=%s",
            exc.reason,
            request.method,
            request.url.path,
            correlation_id,
        )
        return JSONResponse(
            {"detail": "Account unavailable", "code": "account_inactive"},
            status_code=403,
            headers={"X-Correlation-ID": correlation_id},
        )
    except ControlPlaneUnavailableError as exc:
        reason = control_plane_error_reason(exc)
        logger.error(
            "auth_reject reason=%s method=%s path=%s correlation_id=%s category=%s",
            reason,
            request.method,
            request.url.path,
            correlation_id,
            type(exc.__cause__).__name__ if exc.__cause__ else "unavailable",
        )
        return JSONResponse(
            {
                "detail": "Control plane temporarily unavailable",
                "code": "control_plane_unavailable",
            },
            status_code=503,
            headers={"X-Correlation-ID": correlation_id},
        )
    except ProductAccessDeniedError as exc:
        logger.warning(
            "auth_reject reason=%s method=%s path=%s correlation_id=%s",
            exc.reason,
            request.method,
            request.url.path,
            correlation_id,
        )
        detail = (
            "Capinsta is temporarily unavailable"
            if exc.reason == "maintenance_mode"
            else "Product access denied"
        )
        return JSONResponse(
            {"detail": detail, "code": exc.reason},
            status_code=exc.status_code,
            headers={"X-Correlation-ID": correlation_id},
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"detail": str(exc.detail)}
        headers = {"X-Correlation-ID": correlation_id, **dict(exc.headers or {})}
        return JSONResponse(
            detail,
            status_code=exc.status_code,
            headers=headers,
        )
    except Exception:
        logger.exception(
            "auth_reject reason=unexpected method=%s path=%s correlation_id=%s",
            request.method,
            request.url.path,
            correlation_id,
        )
        return JSONResponse(
            {"detail": "Internal authentication error", "code": "auth_internal_error"},
            status_code=500,
            headers={"X-Correlation-ID": correlation_id},
        )
    context_token = set_current_user(user)
    try:
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response
    finally:
        reset_current_user(context_token)

# CORS configuration for Frontend interaction
default_origins = [] if os.getenv("NODE_ENV") == "production" else [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:3010",
    "http://127.0.0.1:3010",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
configured_origins = env_list("FRONTEND_URL", []) + env_list("CORS_ORIGINS", [])
allow_origins = list(dict.fromkeys(default_origins + configured_origins))
allow_all_origins = "*" in allow_origins and os.getenv("NODE_ENV") != "production"
if "*" in allow_origins and os.getenv("NODE_ENV") == "production":
    logger.warning("cors_wildcard_ignored_in_production")
    allow_origins = [origin for origin in allow_origins if origin != "*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all_origins else allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add API routers
app.include_router(health.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(export_jobs.router, prefix="/api")
app.include_router(captions.router, prefix="/api")
app.include_router(media_assets.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(admin.internal_router, prefix="/api")
app.include_router(health.router, prefix="/api/v1")
app.include_router(jobs.router, prefix="/api/v1")
app.include_router(export_jobs.router, prefix="/api/v1")
app.include_router(captions.router, prefix="/api/v1")
app.include_router(media_assets.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")


@app.get("/health", response_model=health.HealthResponse)
async def root_health_check():
    return await health.health_payload()


@app.get("/health/ready", response_model=health.ReadinessResponse)
async def root_readiness_check():
    return health.readiness_payload()


@app.get("/health/startup")
async def root_startup_diagnostics_check():
    return health.startup_diagnostics_payload()


@app.get("/health/export")
async def root_export_health_check():
    return await health.export_health_payload_async()


@app.get("/health/timing")
async def root_timing_health_check():
    return health.timing_health_payload()


ensure_runtime_dirs()
if CAPTION_FONT_DIR.exists():
    app.mount(
        "/caption-fonts",
        StaticFiles(directory=str(CAPTION_FONT_DIR), html=False),
        name="caption-fonts",
    )
    logger.info("caption_fonts_enabled path=%s", CAPTION_FONT_DIR)
else:
    logger.warning("caption_fonts_missing path=%s", CAPTION_FONT_DIR)
if frontend_dist_available():
    next_static_dir = FRONTEND_DIST_DIR / "_next" / "static"
    brand_static_dir = FRONTEND_DIST_DIR / "brand"
    if next_static_dir.exists():
        app.mount("/_next/static", StaticFiles(directory=str(next_static_dir), html=False), name="next-static")
    if brand_static_dir.exists():
        app.mount("/brand", StaticFiles(directory=str(brand_static_dir), html=False), name="brand-static")
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST_DIR), html=True), name="frontend")

# Local dev can still run the Next.js app separately on port 3000.
# A bundled renderer is still supported for local/custom images. Standard
# production deployment uses the independently deployed frontend /render route.


if __name__ == "__main__":
    import uvicorn

    default_host = "0.0.0.0" if os.getenv("NODE_ENV") == "production" or os.getenv("RENDER") else "127.0.0.1"
    host = os.getenv("HOST", default_host)
    try:
        port = int(os.getenv("PORT", "8000"))
    except ValueError:
        logger.warning("Invalid PORT value %r, defaulting to 8000.", os.getenv("PORT"))
        port = 8000

    uvicorn.run(app, host=host, port=port, log_level=os.getenv("LOG_LEVEL", "info").lower())
