# ---- Base ----
# Bun-based build. The repo is a Bun workspace that ships bun.lock, so we use
# `bun install --frozen-lockfile` for reproducible installs. No npm/yarn/pnpm.
FROM oven/bun:alpine AS base

# ---- Builder ----
FROM base AS builder

WORKDIR /app

# Public build-time values only (no secrets). NEXT_PUBLIC_* is baked into the
# client bundle at build time, so it must be a build ARG, not a runtime env.
# Defaults are safe placeholders; Coolify/CI can override via --build-arg.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_MARBLE_API_URL=https://api.marblecms.com
ARG MARBLE_WORKSPACE_KEY=build-placeholder
ARG NEXT_PUBLIC_ENABLE_AI_CAPTIONS=false
ARG NEXT_PUBLIC_CAPINSTA_API_BASE_URL=
# Define optional build args so they can be forwarded, but no real secrets.
ARG FREESOUND_CLIENT_ID=
ARG FREESOUND_API_KEY=

# Copy only what is needed to resolve dependencies first (layer cache friendly).
COPY package.json package.json
COPY bun.lock bun.lock
COPY turbo.json turbo.json
COPY apps/web/package.json apps/web/package.json

# Reproducible install from the committed lockfile.
RUN bun install --frozen-lockfile

# Copy the web app source.
COPY apps/web/ apps/web/

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build-time placeholder values ONLY. These are required for Zod/Next.js to
# compile the production bundle. They are NEVER real secrets. Real credentials
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
RUN bun run build

# ---- Runner ----
# Minimal production image. No dev deps, no source, no build secrets.
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user for the standalone Next.js server.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone output: server.js + minimal node_modules are under .next/standalone.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

RUN chown nextjs:nodejs apps

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Standalone server entrypoint, run under Bun (runtime provided by base image).
CMD ["bun", "apps/web/server.js"]
