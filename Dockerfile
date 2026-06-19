# ---- Stage 1: Installer (Bun) ----
# Bun handles `bun install --frozen-lockfile` (reproducible, workspace-aware).
FROM oven/bun:alpine AS installer

WORKDIR /app

# Copy only manifest + lockfile for a cacheable dependency layer.
COPY package.json package.json
COPY bun.lock bun.lock
COPY turbo.json turbo.json
COPY apps/web/package.json apps/web/package.json

RUN bun install --frozen-lockfile

# ---- Stage 2: Builder (Node + Next.js build) ----
# Node runs `next build`. This avoids Bun's SIGILL/segfault on VPS CPUs that
# Bun (musl build) does not support.
FROM node:22-alpine AS builder

WORKDIR /app

# Bring in installed deps from the Bun stage.
COPY --from=installer /app/node_modules ./node_modules
# Bun keeps workspace-specific packages (including Next config plugins such as
# botid and @content-collections/next) in the workspace node_modules directory.
# Preserve those links so Node can resolve them while loading next.config.ts.
COPY --from=installer /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json package.json
COPY bun.lock bun.lock
COPY turbo.json turbo.json
COPY apps/web/package.json apps/web/package.json

# Copy the web app source.
COPY apps/web/ apps/web/

# Public build-time values only (no secrets). NEXT_PUBLIC_* is baked into the
# client bundle at build time, so it must be a build ARG. Defaults are safe
# placeholders; Coolify/CI can override via --build-arg.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_MARBLE_API_URL=https://api.marblecms.com
ARG MARBLE_WORKSPACE_KEY=build-placeholder
# Caption generation is a core Capinsta feature. Keep it visible unless a
# deployment explicitly opts out with --build-arg ...=false.
ARG NEXT_PUBLIC_ENABLE_AI_CAPTIONS=true
ARG NEXT_PUBLIC_CAPINSTA_API_BASE_URL=

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build-time placeholder values ONLY. Required for Zod/Next.js to compile the
# production bundle. They are NEVER real secrets. Real credentials
# (DATABASE_URL, BETTER_AUTH_SECRET, UPSTASH_*, real MARBLE_WORKSPACE_KEY) are
# injected at runtime via Coolify environment variables.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV BETTER_AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime"
ENV UPSTASH_REDIS_REST_URL="http://localhost:8079"
ENV UPSTASH_REDIS_REST_TOKEN="build-time-placeholder-token"

# Forward public build args into the build environment.
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_MARBLE_API_URL=$NEXT_PUBLIC_MARBLE_API_URL
ENV NEXT_PUBLIC_ENABLE_AI_CAPTIONS=$NEXT_PUBLIC_ENABLE_AI_CAPTIONS
ENV NEXT_PUBLIC_CAPINSTA_API_BASE_URL=$NEXT_PUBLIC_CAPINSTA_API_BASE_URL
ENV MARBLE_WORKSPACE_KEY=$MARBLE_WORKSPACE_KEY

WORKDIR /app/apps/web
RUN ./node_modules/.bin/next build

# ---- Stage 3: Runner (Node standalone server) ----
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user for the standalone Next.js server.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone output: server.js + minimal node_modules under .next/standalone.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

RUN chown nextjs:nodejs apps

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Standalone server entrypoint, run under Node (Bun-free runtime).
CMD ["node", "apps/web/server.js"]
