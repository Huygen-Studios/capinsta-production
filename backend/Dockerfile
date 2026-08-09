# Build context: repository root
# Coolify: Base Directory=/, Dockerfile Location=/backend/Dockerfile
#
# The backend intentionally does not compile Next.js. The isolated Remotion
# exporter is bundled here for durable workers; the API never invokes it.
FROM rust:1.88-slim-bookworm AS clipping-runtime-builder

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY rust/ ./rust/
COPY apps/desktop/ ./apps/desktop/
RUN --mount=type=cache,id=capinsta-cargo-registry,target=/usr/local/cargo/registry \
  --mount=type=cache,id=capinsta-cargo-git,target=/usr/local/cargo/git \
  --mount=type=cache,id=capinsta-cargo-target,target=/build/target \
  cargo build --locked --release -p clipping-runtime \
  && strip target/release/capinsta-clipping-runtime \
  && mkdir -p /build/out \
  && cp target/release/capinsta-clipping-runtime /build/out/capinsta-clipping-runtime

FROM oven/bun:1.3.14 AS remotion-builder
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/remotion-exporter/package.json apps/remotion-exporter/package.json
COPY packages/transcript-contract/package.json packages/transcript-contract/package.json
RUN bun install --frozen-lockfile --filter @capinsta/remotion-exporter
COPY apps/remotion-exporter apps/remotion-exporter
COPY apps/web/src apps/web/src
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/public/caption-fonts apps/web/public/caption-fonts
COPY packages/transcript-contract packages/transcript-contract
WORKDIR /app/apps/remotion-exporter
RUN bunx remotion browser ensure \
  && bun run bundle \
  && bun build src/hybrid-export.ts --target=node --packages=external --outfile=.cache/hybrid-run.mjs

FROM oven/bun:1.3.14 AS remotion-runtime-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/remotion-exporter/package.json apps/remotion-exporter/package.json
COPY packages/transcript-contract/package.json packages/transcript-contract/package.json
RUN bun install --frozen-lockfile --production --filter @capinsta/remotion-exporter

FROM node:22-bookworm-slim AS node-runtime

FROM python:3.11-slim AS app

ARG INSTALL_ALIGNMENT_STACK=false

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV LEGACY_CAPTION_STORAGE_ROOT=/app/storage/legacy-caption
ENV TEMP_DIR=/app/storage/legacy-caption/tmp
ENV UPLOAD_DIR=/app/storage/legacy-caption/uploads
ENV EXPORT_DIR=/app/storage/legacy-caption/exports
ENV CACHE_DIR=/app/storage/legacy-caption/cache
ENV MEDIA_DIR=/app/storage/legacy-caption/media
ENV DB_PATH=/app/storage/legacy-caption/database.sqlite
ENV RUNTIME_CLEANUP_HOURS=24
ENV ABANDONED_UPLOAD_RETENTION_HOURS=24
ENV FAILED_EXPORT_RETENTION_HOURS=6
ENV DOWNLOAD_ARTIFACT_RETENTION_HOURS=24
ENV TEMP_AUDIO_RETENTION_HOURS=6
ENV ORPHAN_SCAN_INTERVAL_SECONDS=86400
ENV DISK_WARNING_FREE_BYTES=1073741824
ENV DISK_REJECT_UPLOAD_FREE_BYTES=268435456
ENV DISK_CRITICAL_FREE_BYTES=134217728
ENV MAX_CONCURRENT_EXPORTS=1
ENV MAX_EXPORT_DURATION_SECONDS=300
ENV EXPORT_RENDER_SAFE_MODE=true
ENV EXPORT_MAX_LONG_EDGE=1920
ENV EXPORT_MAX_FPS=30
ENV EXPORT_SAFE_QUALITY=standard
ENV EXPORT_FFMPEG_THREADS=1
ENV EXPORT_RENDER_PAGE_RECYCLE_FRAMES=0
ENV EXPORT_SPARSE_MIN_FRAME_REDUCTION_PERCENT=30
ENV CAPINSTA_MODEL_CACHE_DIR=/data/capinsta/model-cache
ENV XDG_CACHE_HOME=/data/capinsta/model-cache/xdg
ENV HF_HOME=/data/capinsta/model-cache/huggingface
ENV TORCH_HOME=/data/capinsta/model-cache/torch
ENV WHISPER_CACHE_DIR=/data/capinsta/model-cache/whisper
ENV STABLE_TS_CACHE_DIR=/data/capinsta/model-cache/stable-ts
ENV STABLE_TS_MAX_CONCURRENCY=1
ENV ENABLE_SILERO_VAD=true
ENV REQUIRE_SILERO_VAD=false
ENV CAPINSTA_EXPORT_ENGINE=remotion_hybrid
ENV CAPINSTA_REMOTION_RUNTIME=/app/apps/remotion-exporter/.cache/hybrid-run.mjs
ENV CAPINSTA_REMOTION_TEMP_ROOT=/tmp/capinsta-remotion-export

WORKDIR /app

COPY --from=clipping-runtime-builder \
  /build/out/capinsta-clipping-runtime \
  /usr/local/bin/capinsta-clipping-runtime
COPY --from=node-runtime /usr/local/ /usr/local/
COPY --from=remotion-runtime-deps /app/node_modules /app/node_modules
COPY --from=remotion-runtime-deps /app/apps/remotion-exporter/node_modules /app/apps/remotion-exporter/node_modules
COPY --from=remotion-builder /app/apps/remotion-exporter/node_modules/.remotion /app/apps/remotion-exporter/node_modules/.remotion
COPY --from=remotion-builder /app/apps/remotion-exporter/.cache /app/apps/remotion-exporter/.cache
COPY --from=remotion-builder /app/apps/remotion-exporter/package.json /app/apps/remotion-exporter/package.json

RUN (apt-get update || (sleep 2 && apt-get update)) \
  && apt-get install -y --fix-missing --no-install-recommends -o Acquire::Retries=3 -o=Dpkg::Use-Pty=0 \
    curl \
    gosu \
    wget \
    ca-certificates \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsndfile1 \
    fonts-dejavu-core \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 \
    libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgtk-3-0 libnspr4 libnss3 \
    libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    libxrender1 libxshmfence1 \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
  && echo "backend_system_packages_installed"

COPY backend/requirements.txt backend/requirements-stable-ts.txt ./
RUN --mount=type=cache,id=capinsta-pip-cache,target=/root/.cache/pip \
  export PIP_NO_CACHE_DIR=0 \
  && python -m pip install --upgrade pip \
  && python -m pip install --upgrade setuptools wheel \
  && python -m pip install -r requirements.txt \
  && if [ "$INSTALL_ALIGNMENT_STACK" = "true" ]; then python -m pip install -r requirements-stable-ts.txt; else echo "alignment_stack_skipped"; fi \
  && (apt-get update || true) \
  && python -m playwright install-deps chromium \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
  && python -m playwright install --only-shell chromium \
  && find /usr/local/lib/python3.11 -type d \( -name '__pycache__' -o -name 'tests' -o -name 'test' \) -prune -exec rm -rf '{}' + \
  && find /usr/local/lib/python3.11 -type f \( -name '*.pyc' -o -name '*.pyo' -o -name '*.a' \) -delete \
  && rm -rf \
    /tmp/* \
    /usr/local/lib/python3.11/site-packages/torch/include \
    /usr/local/lib/python3.11/site-packages/torch/share \
    /usr/local/lib/python3.11/site-packages/torch/test

RUN mkdir -p \
    "$CAPINSTA_MODEL_CACHE_DIR" \
    "$XDG_CACHE_HOME" \
    "$HF_HOME" \
    "$TORCH_HOME" \
    "$WHISPER_CACHE_DIR" \
    "$STABLE_TS_CACHE_DIR" \
  && chmod -R 0775 /data/capinsta

COPY backend/ .
COPY apps/web/migrations/ /app/migrations/
COPY backend/docker-entrypoint.sh /usr/local/bin/capinsta-backend-entrypoint
RUN chmod +x /usr/local/bin/capinsta-backend-entrypoint

RUN if [ "$INSTALL_ALIGNMENT_STACK" = "true" ]; then ENABLE_SILERO_VAD=true python -m ai_pipeline.tools.silero_vad_smoke; else echo "silero_vad_smoke_skipped"; fi
RUN printf '%s' '{"protocolVersion":1,"requestId":"docker_health","operation":"health","payload":{},"options":{}}' \
  | capinsta-clipping-runtime >/tmp/clipping-runtime-health.json \
  && grep -q '"ok":true' /tmp/clipping-runtime-health.json \
  && rm /tmp/clipping-runtime-health.json

RUN du -sh /app /usr/local /ms-playwright 2>/dev/null || true

RUN groupadd --system --gid 10001 capinsta \
  && useradd --system --uid 10001 --gid capinsta --home-dir /app capinsta \
    && mkdir -p /tmp/huygen-caps /tmp/capinsta-remotion-export /app/storage/legacy-caption \
    && chown -R capinsta:capinsta /tmp/huygen-caps /tmp/capinsta-remotion-export /app/storage /data/capinsta

USER root

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-10000}/health/live || exit 1

ENTRYPOINT ["capinsta-backend-entrypoint"]
CMD ["sh", "-c", "uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
