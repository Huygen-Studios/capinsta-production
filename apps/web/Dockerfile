FROM oven/bun:alpine AS base

FROM base AS builder

WORKDIR /app

ARG NEXT_PUBLIC_MARBLE_API_URL=https://api.marblecms.com
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=build-placeholder
ARG NEXT_PUBLIC_CAPINSTA_API_BASE_URL=/api/capinsta
ARG NEXT_PUBLIC_ENABLE_AI_CAPTIONS=true
ARG NEXT_PUBLIC_CAPINSTA_EXPORT_STRATEGY=headless
ARG NEXT_PUBLIC_ENABLE_CAPINSTA_PROJECT_HANDOFF=false
ARG NEXT_PUBLIC_ENABLE_SERVER_BACKED_EDITOR_MEDIA=false

COPY package.json package.json
COPY bun.lock bun.lock
COPY turbo.json turbo.json

COPY apps/web/package.json apps/web/package.json
COPY packages/transcript-contract/ packages/transcript-contract/
COPY rust/wasm/pkg/ rust/wasm/pkg/
RUN bun install

COPY apps/web/ apps/web/

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_CAPINSTA_API_BASE_URL=$NEXT_PUBLIC_CAPINSTA_API_BASE_URL
ENV NEXT_PUBLIC_ENABLE_AI_CAPTIONS=$NEXT_PUBLIC_ENABLE_AI_CAPTIONS
ENV NEXT_PUBLIC_MARBLE_API_URL=$NEXT_PUBLIC_MARBLE_API_URL
ENV NEXT_PUBLIC_CAPINSTA_EXPORT_STRATEGY=$NEXT_PUBLIC_CAPINSTA_EXPORT_STRATEGY
ENV NEXT_PUBLIC_ENABLE_CAPINSTA_PROJECT_HANDOFF=$NEXT_PUBLIC_ENABLE_CAPINSTA_PROJECT_HANDOFF
ENV NEXT_PUBLIC_ENABLE_SERVER_BACKED_EDITOR_MEDIA=$NEXT_PUBLIC_ENABLE_SERVER_BACKED_EDITOR_MEDIA

WORKDIR /app/apps/web
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
  BETTER_AUTH_SECRET=build-placeholder-not-used-at-runtime \
  UPSTASH_REDIS_REST_URL=http://localhost:8079 \
  UPSTASH_REDIS_REST_TOKEN=build-placeholder \
  MARBLE_WORKSPACE_KEY=build-placeholder \
  SUPABASE_SERVICE_ROLE_KEY=00000000000000000000 \
  ADMIN_SECURITY_PEPPER=00000000000000000000000000000000 \
  INTERNAL_ADMIN_API_SECRET=00000000000000000000000000000000 \
  INTERNAL_MAINTENANCE_SECRET=00000000000000000000000000000000 \
  ./node_modules/.bin/next build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV ADMIN_ASSERTION_ISSUER="capinsta-web"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

RUN test -d /app/apps/web/.next \
 && test -d /app/apps/web/public \
 && test -d /app/apps/web/.next/static \
 && bun -e "console.log('next_resolved=' + require.resolve('next', { paths: ['/app/apps/web'] }))" \
 && bun /app/apps/web/node_modules/next/dist/bin/next --version \
 || (echo "Expected Next production layout is missing"; \
     echo "server.js files:"; find /app -maxdepth 5 -type f -name server.js -print; \
     echo "next package candidates:"; find /app -maxdepth 7 -path "*/node_modules/next" -print; \
     echo ".next/static directories:"; find /app -maxdepth 6 -type d -path "*/.next/static" -print; \
     echo "public directories:"; find /app -maxdepth 5 -type d -name public -print; \
     exit 1)

ENV WEB_JS_RUNTIME=bun
COPY --chown=nextjs:nodejs apps/web/docker/start-web.sh /app/start-web.sh
RUN chmod +x /app/start-web.sh

RUN chown -R nextjs:nodejs apps

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["/app/start-web.sh"]
