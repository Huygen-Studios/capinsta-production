# CapInsta Remotion export prototype

This is an isolated evaluation CLI. It does not replace or call the production export endpoint.

From the repository root:

```powershell
bun install --filter @capinsta/remotion-exporter
bun run --cwd apps/remotion-exporter fixture
bun run --cwd apps/remotion-exporter bundle
bun run --cwd apps/remotion-exporter render -- --props fixtures/generated/source-only.json --output artifacts/source-only.mp4
```

The bundle is built separately and reused. `render` accepts `--concurrency 1|2` and `--preset veryfast|superfast`. Input is the versioned `CapInstaRemotionPropsV1` contract in `src/contracts.ts`.

Docker build and invocation (build context must be the repository root):

```powershell
docker build -f apps/remotion-exporter/Dockerfile -t capinsta-remotion-prototype .
docker run --rm -v ${PWD}/apps/remotion-exporter/fixtures/generated:/inputs:ro -v ${PWD}/apps/remotion-exporter/fixtures/generated/moving-source-30s.mp4:/app/apps/remotion-exporter/.cache/bundle/remotion-fixtures/moving-source-30s.mp4:ro -v ${PWD}/apps/remotion-exporter/artifacts:/outputs capinsta-remotion-prototype --props /inputs/source-only.json --output /outputs/source-only-docker.mp4
```

The media URL in fixture JSON must be reachable from the bundle's asset server. Production integration will localize private signed media into a per-job workspace before invoking this CLI.

## Isolated hybrid prototype

The hybrid path keeps video, solid backgrounds, EDL, audio, composition, and final H.264 encoding in FFmpeg. Remotion renders only transparent caption/effect PNGs, and is bypassed when captions are absent.

```powershell
bun run fixture
bun run bundle
bun run hybrid -- --props fixtures/generated/ordinary-captions.json --output artifacts/hybrid.mp4 --base video --concurrency 4
bun run hybrid -- --props fixtures/generated/ordinary-captions.json --output artifacts/solid.mp4 --base solidColor --color "#18233A" --concurrency 4
```

Benchmark and acceptance commands require `CAPINSTA_ENV=benchmark` and `CAPINSTA_BENCHMARK_ROOT`. See `docs/remotion-hybrid-evaluation.md` for measured results and limitations.
