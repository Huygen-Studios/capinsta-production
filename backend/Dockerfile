# Build context: repository root
# Coolify: Base Directory=/, Dockerfile Location=/backend/Dockerfile
#
# The backend intentionally does not compile Next.js. Headless export uses the
# independently deployed frontend /render route configured by RENDER_PAGE_URL
# or FRONTEND_URL. This keeps API deployments small and prevents frontend build
# OOM/timeouts from taking down backend releases.
FROM python:3.11-slim AS app

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV TEMP_DIR=/tmp/huygen-caps
ENV UPLOAD_DIR=/tmp/huygen-caps/uploads
ENV EXPORT_DIR=/tmp/huygen-caps/exports
ENV MEDIA_DIR=/tmp/huygen-caps/media
ENV DB_PATH=/tmp/huygen-caps/database.sqlite
ENV RUNTIME_CLEANUP_HOURS=24
ENV ABANDONED_UPLOAD_RETENTION_HOURS=24
ENV FAILED_EXPORT_RETENTION_HOURS=6
ENV DOWNLOAD_ARTIFACT_RETENTION_HOURS=24
ENV TEMP_AUDIO_RETENTION_HOURS=6
ENV ORPHAN_SCAN_INTERVAL_SECONDS=86400
ENV DISK_WARNING_FREE_BYTES=8589934592
ENV DISK_REJECT_UPLOAD_FREE_BYTES=5368709120
ENV DISK_CRITICAL_FREE_BYTES=2147483648
ENV MAX_CONCURRENT_EXPORTS=1
ENV MAX_EXPORT_DURATION_SECONDS=300
ENV EXPORT_RENDER_SAFE_MODE=true
ENV EXPORT_MAX_LONG_EDGE=1920
ENV EXPORT_MAX_FPS=30
ENV EXPORT_SAFE_QUALITY=standard
ENV EXPORT_FFMPEG_THREADS=1
ENV EXPORT_RENDER_PAGE_RECYCLE_FRAMES=0
ENV EXPORT_CLEAN_CHECK_INTERVAL_FRAMES=0
ENV EXPORT_FRAME_CAPTURE_RETRIES=2
ENV EXPORT_LEGACY_CAPTIONS_ONLY_DISK_PIPELINE=false
ENV EXPORT_SPARSE_RENDER_ENABLED=true
ENV EXPORT_SPARSE_RENDER_THEMES=*
ENV EXPORT_SPARSE_MIN_FRAME_REDUCTION_PERCENT=30
ENV CAPINSTA_MODEL_CACHE_DIR=/data/capinsta/model-cache
ENV XDG_CACHE_HOME=/data/capinsta/model-cache/xdg
ENV HF_HOME=/data/capinsta/model-cache/huggingface
ENV TORCH_HOME=/data/capinsta/model-cache/torch
ENV WHISPER_CACHE_DIR=/data/capinsta/model-cache/whisper
ENV STABLE_TS_CACHE_DIR=/data/capinsta/model-cache/stable-ts
ENV STABLE_TS_MAX_CONCURRENCY=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    ffmpeg \
    libgomp1 \
    libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt backend/requirements-stable-ts.txt ./
RUN python -m pip install --upgrade pip \
  && python -m pip install --upgrade setuptools wheel \
  && python -m pip install -r requirements.txt \
  && python -m pip install -r requirements-stable-ts.txt \
  && python -m playwright install-deps chromium \
  && rm -rf /var/lib/apt/lists/* \
  && python -m playwright install --only-shell chromium

RUN mkdir -p \
    "$CAPINSTA_MODEL_CACHE_DIR" \
    "$XDG_CACHE_HOME" \
    "$HF_HOME" \
    "$TORCH_HOME" \
    "$WHISPER_CACHE_DIR" \
    "$STABLE_TS_CACHE_DIR" \
  && chmod -R 0775 /data/capinsta

COPY backend/ .

RUN ENABLE_SILERO_VAD=true python -m ai_pipeline.tools.silero_vad_smoke

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:10000/health || exit 1

CMD ["sh", "-c", "uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
