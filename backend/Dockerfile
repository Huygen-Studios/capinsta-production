FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app/frontend
ENV NEXT_PUBLIC_API_URL=
ENV NEXT_OUTPUT=export
ENV NEXT_TELEMETRY_DISABLED=1

COPY frontend/package*.json ./
RUN npm ci --include=dev

COPY frontend ./
ENV NODE_ENV=production
RUN npm run build


FROM python:3.11-slim AS app

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV TEMP_DIR=/tmp/huygen-caps
ENV UPLOAD_DIR=/tmp/huygen-caps/uploads
ENV EXPORT_DIR=/tmp/huygen-caps/exports
ENV DB_PATH=/tmp/huygen-caps/database.sqlite
ENV RUNTIME_CLEANUP_HOURS=24
ENV MAX_CONCURRENT_EXPORTS=1
ENV MAX_EXPORT_DURATION_SECONDS=300
ENV EXPORT_RENDER_SAFE_MODE=true
ENV EXPORT_MAX_LONG_EDGE=1280
ENV EXPORT_MAX_FPS=24
ENV EXPORT_SAFE_QUALITY=standard
ENV EXPORT_FFMPEG_THREADS=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --upgrade pip \
  && python -m pip install -r requirements.txt \
  && python -m playwright install --with-deps chromium

COPY . .
COPY --from=frontend-builder /app/frontend/out ./frontend/out

EXPOSE 10000

CMD ["sh", "-c", "uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
