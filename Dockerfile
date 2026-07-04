# ---- Stage 1: Builder (Bun install + Node Next.js build) ----
# Bun handles `bun install --frozen-lockfile` (reproducible, workspace-aware).
# Node runs `next build`. Installing Node in this same stage avoids copying a
# full node_modules tree between Docker stages, which can exhaust small Coolify
# hosts before the app even starts compiling.
FROM oven/bun:alpine AS builder

WORKDIR /app

RUN apk add --no-cache nodejs

# Copy only manifest + lockfile for a cacheable dependency layer.
COPY package.json package.json
COPY bun.lock bun.lock
COPY turbo.json turbo.json
COPY apps/web/package.json apps/web/package.json

RUN --mount=type=cache,id=capinsta-bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# Copy the web app source.
COPY apps/web/ apps/web/

# Public build-time values only (no secrets). NEXT_PUBLIC_* is baked into the
# client bundle at build time, so it must be a build ARG. Defaults are safe
# placeholders; Coolify/CI can override via --build-arg.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=build-placeholder
ARG NEXT_PUBLIC_MARBLE_API_URL=https://api.marblecms.com
ARG MARBLE_WORKSPACE_KEY=build-placeholder
# Caption generation is a core Capinsta feature. Keep it visible unless a
# deployment explicitly opts out with --build-arg ...=false.
ARG NEXT_PUBLIC_ENABLE_AI_CAPTIONS=true

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Keep the Next.js compiler bounded during Docker builds, but do not starve
# Turbopack's type/page-data workers. Coolify's previous 1 GB heap cap caused
# SIGABRT during `next build` after compilation succeeded.
ARG NEXT_BUILD_HEAP_MB=2048
ENV NODE_OPTIONS="--max-old-space-size=${NEXT_BUILD_HEAP_MB}"

# Build-time placeholder values ONLY. Required for Zod/Next.js to compile the
# production bundle. They are NEVER real secrets. Real credentials
# (DATABASE_URL, BETTER_AUTH_SECRET, UPSTASH_*, real MARBLE_WORKSPACE_KEY) are
# injected at runtime via Coolify environment variables.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV UPSTASH_REDIS_REST_URL="http://localhost:8079"
ENV UPSTASH_REDIS_REST_TOKEN="build-time-placeholder-token"
ENV SUPABASE_SERVICE_ROLE_KEY="build-time-placeholder-service-role-key"
ENV ADMIN_SECURITY_PEPPER="build-time-placeholder-admin-security-pepper"
ENV INTERNAL_ADMIN_API_SECRET="build-time-placeholder-internal-admin-api-secret"
ENV INTERNAL_MAINTENANCE_SECRET="build-time-placeholder-maintenance-secret"
ENV ADMIN_ASSERTION_ISSUER="capinsta-web"
ENV BACKEND_INTERNAL_URL="http://127.0.0.1:10000"
ENV TRUSTED_PROXY_MODE="none"

# Forward public build args into the build environment.
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_MARBLE_API_URL=$NEXT_PUBLIC_MARBLE_API_URL
ENV NEXT_PUBLIC_ENABLE_AI_CAPTIONS=$NEXT_PUBLIC_ENABLE_AI_CAPTIONS
ENV MARBLE_WORKSPACE_KEY=$MARBLE_WORKSPACE_KEY

WORKDIR /app/apps/web
# Next/Turbopack can be silent for several minutes on a small Coolify VPS.
# Emit a periodic heartbeat so the remote deployment helper does not mistake a
# healthy compile for a stalled command. Preserve Next's incremental cache so a
# failed/retried deployment does not repeat all compilation work.
RUN --mount=type=cache,id=capinsta-next-cache,target=/app/apps/web/.next/cache \
    set -eu; \
    (while sleep 25; do echo "capinsta_next_build_active"; done) & \
    heartbeat_pid=$!; \
    trap 'kill "$heartbeat_pid" 2>/dev/null || true' EXIT; \
    node ./node_modules/next/dist/bin/next build

# ---- Stage 2: Production dependencies ----
# Keep build-only packages out of the runtime image. The builder needs
# TypeScript, ESLint, Sentry build helpers, Playwright, and other heavy tooling;
# `next start` does not.
FROM oven/bun:alpine AS runtime-deps

WORKDIR /app

COPY package.json package.json
COPY bun.lock bun.lock
COPY turbo.json turbo.json
COPY apps/web/package.json apps/web/package.json

RUN --mount=type=cache,id=capinsta-bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

# ---- Stage 3: Runner (Node Next.js server) ----
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV UPSTASH_REDIS_REST_URL="http://localhost:8079"
ENV UPSTASH_REDIS_REST_TOKEN="build-time-placeholder-token"
ENV SUPABASE_SERVICE_ROLE_KEY="build-time-placeholder-service-role-key"
ENV ADMIN_SECURITY_PEPPER="build-time-placeholder-admin-security-pepper"
ENV INTERNAL_ADMIN_API_SECRET="build-time-placeholder-internal-admin-api-secret"
ENV INTERNAL_MAINTENANCE_SECRET="build-time-placeholder-maintenance-secret"
ENV ADMIN_ASSERTION_ISSUER="capinsta-web"
ENV BACKEND_INTERNAL_URL="http://127.0.0.1:10000"
ENV TRUSTED_PROXY_MODE="none"
ENV NEXT_PUBLIC_SITE_URL="http://localhost:3000"
ENV NEXT_PUBLIC_SUPABASE_URL="https://example.supabase.co"
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY="build-placeholder"
ENV NEXT_PUBLIC_MARBLE_API_URL="https://api.marblecms.com"
ENV NEXT_PUBLIC_ENABLE_AI_CAPTIONS="true"
ENV MARBLE_WORKSPACE_KEY="build-placeholder"

# Non-root user for the Next.js server.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=runtime-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=runtime-deps --chown=nextjs:nodejs /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

RUN test -d /app/apps/web/.next \
 && test -d /app/apps/web/public \
 && test -d /app/apps/web/.next/static \
 && node -e "console.log('next_resolved=' + require.resolve('next', { paths: ['/app/apps/web'] }))" \
 && node /app/apps/web/node_modules/next/dist/bin/next --version \
 || (echo "Expected Next production layout is missing"; \
     echo "server.js files:"; find /app -maxdepth 5 -type f -name server.js -print; \
     echo "next package candidates:"; find /app -maxdepth 7 -path "*/node_modules/next" -print; \
     echo ".next/static directories:"; find /app -maxdepth 6 -type d -path "*/.next/static" -print; \
     echo "public directories:"; find /app -maxdepth 5 -type d -name public -print; \
     exit 1)

ENV WEB_JS_RUNTIME=node
COPY --chown=nextjs:nodejs apps/web/docker/start-web.sh /app/start-web.sh
RUN chmod +x /app/start-web.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Next production server entrypoint, run under Node (Bun-free runtime).
CMD ["/app/start-web.sh"]
