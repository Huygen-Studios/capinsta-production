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
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import shutil

# These imports will trigger ai_pipeline logic
from .database import init_db
from .project_cleanup import project_cleanup_loop, stop_cleanup_task
from .api import captions, health, jobs, export_jobs
from .settings import cleanup_old_runtime_files, ensure_runtime_dirs, env_list, frontend_dist_available, FRONTEND_DIST_DIR, EXPORT_DIR
from .auth import authenticate_request, reset_current_user, set_current_user

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize Database
    ensure_runtime_dirs()
    await init_db()
    recovered_exports = await export_jobs.recover_orphaned_export_jobs()
    if recovered_exports:
        logger.warning("export_jobs_recovered_orphaned count=%s", recovered_exports)
    removed = cleanup_old_runtime_files()
    if removed:
        logger.info("runtime_cleanup removed_files=%s", removed)
    cleanup_task = asyncio.create_task(project_cleanup_loop(), name="project-inactivity-cleanup")
    
    # Check for crucial runtime dependencies and API keys.
    stt_provider = os.getenv("STT_PROVIDER", "auto").strip() or "auto"
    groq_key = os.getenv("GROQ_API_KEY", "")
    openai_key = os.getenv("OPENAI_API_KEY", "")
    sarvam_key = os.getenv("SARVAM_API_KEY", "")
    if stt_provider == "auto" and not any([groq_key, openai_key, sarvam_key]):
        print("WARNING: No STT provider API key is configured. Caption generation will fail until a key is set.")
    if stt_provider in {"whisper", "groq_whisper"} and (not groq_key or "your_groq_api_key" in groq_key):
        print("WARNING: GROQ_API_KEY is not set or is still a placeholder. Transcription will fail.")
    if stt_provider == "sarvam" and not sarvam_key:
        print("WARNING: STT_PROVIDER=sarvam requires SARVAM_API_KEY. Transcription will fail.")
    if not shutil.which("ffmpeg"):
        print("WARNING: FFmpeg is not on PATH. Set FFMPEG_PATH or install FFmpeg.")
    if not shutil.which("ffprobe"):
        print("WARNING: FFprobe is not on PATH. Export and validation may fail.")
    if frontend_dist_available():
        logger.info("frontend_static_enabled path=%s", FRONTEND_DIST_DIR)
    else:
        logger.info("frontend_static_missing path=%s local_dev_expected=true", FRONTEND_DIST_DIR)
        
    try:
        yield
    finally:
        await stop_cleanup_task(cleanup_task)
        print("Shutting down the server...")


app = FastAPI(
    title="Huygen Caps",
    description="AI-powered short-form captioning engine for English, Hinglish, and Telgish",
    version="5.0.0",
    lifespan=lifespan
)

PROTECTED_API_PREFIXES = ("/api/jobs", "/api/export/jobs", "/api/captions/jobs")


@app.middleware("http")
async def require_supabase_auth(request: Request, call_next):
    if not request.url.path.startswith(PROTECTED_API_PREFIXES):
        return await call_next(request)
    try:
        user = authenticate_request(request)
    except HTTPException:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    context_token = set_current_user(user)
    try:
        return await call_next(request)
    finally:
        reset_current_user(context_token)

# CORS configuration for Frontend interaction
default_origins = [
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
allow_all_origins = "*" in allow_origins

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


@app.get("/health", response_model=health.HealthResponse)
async def root_health_check():
    return health.health_payload()


@app.get("/health/export")
async def root_export_health_check():
    return await health.export_health_payload_async()


@app.get("/health/timing")
async def root_timing_health_check():
    return health.timing_health_payload()


ensure_runtime_dirs()
if frontend_dist_available():
    next_static_dir = FRONTEND_DIST_DIR / "_next" / "static"
    brand_static_dir = FRONTEND_DIST_DIR / "brand"
    if next_static_dir.exists():
        app.mount("/_next/static", StaticFiles(directory=str(next_static_dir), html=False), name="next-static")
    if brand_static_dir.exists():
        app.mount("/brand", StaticFiles(directory=str(brand_static_dir), html=False), name="brand-static")
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST_DIR), html=True), name="frontend")

# Local dev can still run the Next.js app separately on port 3000.
# Production Docker builds frontend/out and serves it from this FastAPI app.


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
