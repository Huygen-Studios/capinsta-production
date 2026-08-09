FROM oven/bun:1.3.14 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/remotion-exporter/package.json apps/remotion-exporter/package.json
COPY packages/transcript-contract/package.json packages/transcript-contract/package.json
RUN bun install --frozen-lockfile --filter @capinsta/remotion-exporter

FROM dependencies AS build
WORKDIR /app/apps/remotion-exporter
RUN bunx remotion browser ensure
WORKDIR /app
COPY apps/remotion-exporter apps/remotion-exporter
COPY apps/web/src apps/web/src
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/public/caption-fonts apps/web/public/caption-fonts
COPY packages/transcript-contract packages/transcript-contract
WORKDIR /app/apps/remotion-exporter
RUN bun run bundle
RUN bun build src/hybrid-export.ts --target=node --packages=external --outfile=.cache/hybrid-run.mjs \
    && bun build src/alpha-audit.ts --target=node --packages=external --outfile=.cache/alpha-audit-run.mjs \
    && bun build src/solid-color-audit.ts --target=node --packages=external --outfile=.cache/solid-color-audit-run.mjs

FROM oven/bun:1.3.14 AS runtime-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/remotion-exporter/package.json apps/remotion-exporter/package.json
COPY packages/transcript-contract/package.json packages/transcript-contract/package.json
RUN bun install --frozen-lockfile --production --filter @capinsta/remotion-exporter

FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-dejavu-core \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc-s1 libglib2.0-0 \
    libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
    libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxkbcommon0 libxrandr2 libxrender1 libxshmfence1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package.json
COPY --from=runtime-deps /app/node_modules /app/node_modules
COPY --from=build /app/packages/transcript-contract /app/packages/transcript-contract
COPY --from=build /app/apps/remotion-exporter/package.json /app/apps/remotion-exporter/package.json
COPY --from=runtime-deps /app/apps/remotion-exporter/node_modules /app/apps/remotion-exporter/node_modules
COPY --from=build /app/apps/remotion-exporter/node_modules/.remotion /app/apps/remotion-exporter/node_modules/.remotion
COPY --from=build /app/apps/remotion-exporter/.cache /app/apps/remotion-exporter/.cache

ENTRYPOINT ["node", "apps/remotion-exporter/.cache/hybrid-run.mjs"]
