FROM oven/bun:alpine AS base

FROM base AS builder

WORKDIR /app

ARG NEXT_PUBLIC_MARBLE_API_URL=https://api.marblecms.com
ARG MARBLE_WORKSPACE_KEY=build-placeholder

COPY package.json package.json
COPY bun.lock bun.lock
COPY turbo.json turbo.json

COPY apps/web/package.json apps/web/package.json
RUN bun install

COPY apps/web/ apps/web/

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build-time env stubs to pass zod validation
ENV DATABASE_URL="postgresql://opencut:opencut@localhost:5432/opencut"
ENV BETTER_AUTH_SECRET="build-time-secret"
ENV UPSTASH_REDIS_REST_URL="http://localhost:8079"
ENV UPSTASH_REDIS_REST_TOKEN="example_token"
ENV NEXT_PUBLIC_SITE_URL="http://localhost:3000"
ENV NEXT_PUBLIC_MARBLE_API_URL=$NEXT_PUBLIC_MARBLE_API_URL
ENV MARBLE_WORKSPACE_KEY=$MARBLE_WORKSPACE_KEY

WORKDIR /app/apps/web
RUN ./node_modules/.bin/next build --webpack

# Production image
FROM base AS runner
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

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./apps/web
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

RUN test -f /app/apps/web/server.js \
 && test -d /app/apps/web/public \
 && test -d /app/apps/web/.next/static \
 || (echo "Expected Next standalone layout is missing"; \
     echo "server.js files:"; find /app -maxdepth 5 -type f -name server.js -print; \
     echo ".next/static directories:"; find /app -maxdepth 6 -type d -path "*/.next/static" -print; \
     echo "public directories:"; find /app -maxdepth 5 -type d -name public -print; \
     exit 1)

RUN chown -R nextjs:nodejs apps

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["bun", "/app/apps/web/server.js"]
