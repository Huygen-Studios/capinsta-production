FROM oven/bun:1.3.14 AS build
WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile --filter @capinsta/remotion-exporter
RUN bun run --cwd apps/remotion-exporter bundle
RUN bun build apps/remotion-exporter/src/render.ts --target=node --packages=external --outfile=apps/remotion-exporter/.cache/render-run.mjs
WORKDIR /app/apps/remotion-exporter
RUN bunx remotion browser ensure

FROM oven/bun:1.3.14 AS runtime-deps
WORKDIR /app
COPY . .
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

ENTRYPOINT ["node", "apps/remotion-exporter/.cache/render-run.mjs"]
