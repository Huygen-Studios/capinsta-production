# Build context: repository root
# Coolify: Base Directory=/, Dockerfile Location=/backend/Dockerfile

# ---- Stage 1: install the web workspace dependencies ----
FROM oven/bun:1.3.14-alpine AS web-installer

WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/package.json

RUN bun install --frozen-lockfile

# ---- Stage 2: build and package the production render page ----
FROM node:22-alpine AS render-builder

WORKDIR /app

COPY --from=web-installer /app/node_modules ./node_modules
COPY --from=web-installer /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/web/ apps/web/
COPY backend/scripts/package_render_artifact.mjs backend/scripts/package_render_artifact.mjs

ARG NEXT_PUBLIC_SITE_URL=https://capinsta.huygenstudios.com
ARG NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=build-placeholder
ARG NEXT_PUBLIC_MARBLE_API_URL=https://api.marblecms.com
ARG MARBLE_WORKSPACE_KEY=build-placeholder
ARG NEXT_PUBLIC_ENABLE_AI_CAPTIONS=true
ARG NEXT_PUBLIC_CAPINSTA_API_BASE_URL=https://api.capinsta.huygenstudios.com

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The backend image builds the dedicated Next.js render artifact. Bound the
# compiler heap so it cannot starve Coolify and the reverse proxy on small VPSes.
ENV NODE_OPTIONS="--max-old-space-size=1536"
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV UPSTASH_REDIS_REST_URL="http://localhost:8079"
ENV UPSTASH_REDIS_REST_TOKEN="build-time-placeholder-token"
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_MARBLE_API_URL=$NEXT_PUBLIC_MARBLE_API_URL
ENV MARBLE_WORKSPACE_KEY=$MARBLE_WORKSPACE_KEY
ENV NEXT_PUBLIC_ENABLE_AI_CAPTIONS=$NEXT_PUBLIC_ENABLE_AI_CAPTIONS
ENV NEXT_PUBLIC_CAPINSTA_API_BASE_URL=$NEXT_PUBLIC_CAPINSTA_API_BASE_URL

WORKDIR /app/apps/web
RUN ./node_modules/.bin/next build

WORKDIR /app
RUN node backend/scripts/package_render_artifact.mjs apps/web/.next /render-dist

# ---- Stage 3: production API/exporter ----
FROM python:3.11-slim AS app

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV TEMP_DIR=/tmp/huygen-caps
ENV UPLOAD_DIR=/tmp/huygen-caps/uploads
ENV EXPORT_DIR=/tmp/huygen-caps/exports
ENV DB_PATH=/tmp/huygen-caps/database.sqlite
ENV RUNTIME_CLEANUP_HOURS=24
ENV MAX_CONCURRENT_EXPORTS=1
ENV MAX_EXPORT_DURATION_SECONDS=300
ENV EXPORT_RENDER_SAFE_MODE=false
ENV EXPORT_MAX_LONG_EDGE=0
ENV EXPORT_MAX_FPS=120
ENV EXPORT_SAFE_QUALITY=standard
ENV EXPORT_FFMPEG_THREADS=auto
ENV EXPORT_RENDER_PAGE_RECYCLE_FRAMES=0
ENV EXPORT_CLEAN_CHECK_INTERVAL_FRAMES=0
ENV EXPORT_STREAM_RETRIES=2
ENV EXPORT_LEGACY_CAPTIONS_ONLY_DISK_PIPELINE=false
ENV EXPORT_SPARSE_RENDER_ENABLED=true
ENV EXPORT_SPARSE_RENDER_THEMES=word_highlight_box
ENV EXPORT_SPARSE_MIN_FRAME_REDUCTION_PERCENT=5

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN python -m pip install --upgrade pip \
  && python -m pip install -r requirements.txt \
  && python -m playwright install --with-deps chromium

COPY backend/ .
COPY --from=render-builder /render-dist ./frontend/out

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:10000/health || exit 1

CMD ["sh", "-c", "uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
