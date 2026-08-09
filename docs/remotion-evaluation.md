# Remotion export evaluation

Date: 2026-08-09. Status: isolated prototype; production remains on the existing exporter.

## Recommendation

**Keep Remotion isolated; do not integrate this renderer configuration into production.** Correctness remains strong, but phase-2 tuning found no compliant performance improvement. The selected 180-second run took 676.203s, 13.53% slower than the 595.602s phase-1 reference. Further work should target frame-generation architecture, not renderer knobs, and still requires private-media, Linux/KVM2, pixel-diff, worker, and licensing gates.

## A. Version and research

All Remotion dependencies are pinned to exactly `4.0.507`: `remotion`, `@remotion/media`, `@remotion/renderer`, `@remotion/bundler`, and `@remotion/cli`. The version was verified using the npm registry and `remotion versions`; the GitHub releases page still exposed 4.0.505 when evaluated. No caret, tilde, or `latest` range is used.

Implementation follows the current official SSR flow: build once with `bundle()`, reuse that bundle, call `selectComposition()` with the same input props, then call `renderMedia()`. It uses `openBrowser()` for optional worker-level reuse, `makeCancelSignal()`, `calculateMetadata()`, `<Video>` from `@remotion/media`, `<Sequence>`, bounded concurrency, a 512 MiB media cache, H.264, explicit CRF, and `yuv420p`.

Relevant official documentation:

- [Server-side rendering](https://www.remotion.dev/docs/ssr)
- [renderMedia()](https://www.remotion.dev/docs/renderer/render-media)
- [selectComposition()](https://www.remotion.dev/docs/renderer/select-composition)
- [openBrowser()](https://www.remotion.dev/docs/renderer/open-browser)
- [makeCancelSignal()](https://www.remotion.dev/docs/renderer/make-cancel-signal)
- [Dynamic metadata](https://www.remotion.dev/docs/dynamic-metadata)
- [Video](https://www.remotion.dev/docs/media/video) and [Sequence](https://www.remotion.dev/docs/sequence)
- [Docker deployment](https://www.remotion.dev/docs/docker)

Remotion uses a special commercial license. License eligibility must be confirmed before production launch; this evaluation makes no assumption about company size or eligibility.

## B. Architecture

```text
CapInsta project
      |
authoritative Rust-generated EDL + existing caption document/style contracts
      |
CapInstaRemotionPropsV1 adapter (validated, version: 1)
      |
CapInstaExport composition / calculateMetadata
      |                         |
EDL <Sequence> + <Video>        existing CapinstaCaptionRenderer
      |                         |
      +------- final frame -----+
                  |
             renderMedia()
                  |
        H.264 yuv420p + AAC MP4
```

`apps/remotion-exporter` is a separate workspace. Neither `@remotion/renderer` nor `@remotion/bundler` enters the Next.js build, and the existing API, `/render`, Python/Playwright implementation, and production worker default are unchanged.

## C. Reuse report

The composition directly reuses:

- `CapinstaCaptionRenderer` and, through it, `OriginalCaptionRenderer`.
- `originalAdapter`, style migration/normalization, preset registry, style contracts, and `premiumLockup` behavior.
- The existing locally bundled Poppins, Montserrat, and Tactic font assets and font registry.
- `EditDecisionListV1` and its validator from `@capinsta/transcript-contract`, generated from the Rust clip-domain contract.

No caption renderer or preset-specific visual logic was forked. The only web-side refactor narrows the caption renderer's TypeScript presentation-model dependency; runtime behavior is unchanged. Remotion time is `frame / fps` and is passed into the same deterministic renderer.

EDL milliseconds are rounded once at each absolute boundary using CapInsta's positive half-up frame rule. Sequences carry the existing `playbackRate`; reverse and zero rates are rejected. Remote HTTPS sources support optional `requestInit`, but the accepted prototype fixtures use recorded `localized` mode and an HTTP-served bundle asset—never `file://`. Production should download a signed URL once into an isolated job workspace and expose it through the bundle server; query strings and authorization data must remain out of logs.

## D. Files changed

- `apps/remotion-exporter/package.json`, `tsconfig.json`, `.gitignore`: isolated workspace, exact dependencies, commands, generated-output exclusions.
- `src/contracts.ts`: versioned adapter, Zod validation, authoritative EDL validation, metadata/frame/quality mapping.
- `src/Root.tsx`, `CapInstaComposition.tsx`, `CapInstaVideoTrack.tsx`, `CapInstaCaptionLayer.tsx`, `FontGate.tsx`, `index.ts`: the one composition, EDL video/audio track, reused captions, and strict local-font readiness.
- `src/bundle.ts`, `paths.ts`: explicit reusable bundle with only required public media/fonts copied into it.
- `src/render.ts`, `progress.ts`, `cancellation.ts`, `verify.ts`: SSR CLI, structured progress/errors, cancellation, cleanup, and FFprobe verification.
- `src/fixture.ts`, `smoke.ts`, `benchmark.ts`, `legacy_benchmark.py`: deterministic real-video fixtures and reproducible integration/benchmark drivers.
- `src/*.test.ts`, `opencut-wasm.d.ts`: focused contract/timing/EDL/progress/cancellation/output tests and a local declaration correction for the generated package typing.
- `Dockerfile`, `README.md`: separate Bookworm/Node 22 prototype image and operator commands.
- `apps/web/src/capinsta/render/CapinstaCaptionRenderer.tsx`: type-only narrowing to its actual presentation input.
- `bun.lock`: exact dependency resolution.
- `docs/remotion-evaluation.md`: this evidence and next-phase plan.

## E. Tests and real outputs

Commands:

```powershell
bun run --cwd apps/remotion-exporter typecheck
bun run --cwd apps/remotion-exporter test
bun run --cwd apps/remotion-exporter fixture
bun run --cwd apps/remotion-exporter bundle
bun run --cwd apps/remotion-exporter render -- --props fixtures/generated/source-only.json --output artifacts/source-only-yuv420p.mp4
bun run --cwd apps/remotion-exporter render -- --props fixtures/generated/ordinary-captions.json --output artifacts/ordinary-captions.mp4
bun run --cwd apps/remotion-exporter smoke -- artifacts/premium-smoke
bun run --cwd apps/remotion-exporter render -- --props fixtures/generated/edl.json --output artifacts/edl.mp4
```

Automated result: 9 tests pass, 0 fail. Coverage includes props validation, metadata and half-up frame conversion, EDL sequence mapping, 0.5×/1×/2× retention, composition caption time, quality-to-CRF mapping, sampled progress, cancellation handlers, and real FFmpeg/FFprobe output acceptance/rejection.

Acceptance outputs, relative to `apps/remotion-exporter`:

| Output | Codec / pixel | Dimensions / FPS | Frames / video duration | Audio | Bytes | Render |
|---|---|---|---|---|---:|---:|
| `artifacts/source-only-yuv420p.mp4` | H.264 / yuv420p | 1080×1920 / 30 | 900 / 30.000s | AAC | 18,599,886 | 101.810s |
| `artifacts/ordinary-captions.mp4` | H.264 / yuv420p | 1080×1920 / 30 | 900 / 30.000s | AAC | 14,867,058 | 102.988s |
| `artifacts/edl.mp4` | H.264 / yuv420p | 1080×1920 / 30 | 525 / 17.500s | AAC | 8,818,431 | 62.338s |
| `artifacts/retiming.mp4` | H.264 / yuv420p | 1080×1920 / 30 | 210 / 7.000s | AAC | 3,606,393 | 22.854s |
| `artifacts/premium-smoke/*.mp4` (8) | H.264 / yuv420p | 1080×1920 / 30 | 120 / 4.000s each | AAC | 5.63–5.73 MB each | 11.44–13.24s each |
| `artifacts/representative-180s.mp4` | H.264 / yuv420p | 1080×1920 / 30 | 5,400 / 180.000s | AAC | 203,850,456 | 595.602s |

The source fixture is a 30-second 1080×1920 30 FPS `testsrc2` grid with moving geometry, burned frame number/timestamp, and a one-second audio pulse. Consecutive source/output frame hashes differ and FFmpeg `freezedetect=n=-50dB:d=0.1` reported no frozen runs. Ordinary-caption samples show active-word gold highlighting while the burned source advances. Visual samples for skyline, citrus, volt, cobalt, and monument preserve their distinct role layout, scale, gradients/reveals, and backgrounds; ember, ivory, and mint also completed real MP4 smoke renders. No green/chroma artifact appears.

EDL inspection at output timestamps confirms source timestamps `4.9 → 10.1 → 14.9 → 5.1 → 9.9`, followed by a repeated `5–10s` range at 2× (`5.2` at output 15.1s and `9.8` at output 17.4s). Audio is carried by each `<Video>` once, so no duplicate audio track is created. A separate real retiming output covers 0.5×, 1×, and 2×: burned frames advance `0.9 → 1.9` over two output seconds, `2.2 → 3.8` over 1.6 seconds, and `4.4 → 5.6` over 0.6 seconds. Audio pulse gaps scale from about 1.76s to 0.88s to 0.44s, confirming matching audio retiming. Reverse playback is explicitly unsupported.

Visual parity is architectural rather than a second implementation: ordinary, skyline, citrus, cobalt, and monument frames are emitted by the exact component/style functions used by editor preview. The inspected fields—text, line breaks, font family/weight, placement, active word, colors/background, and animation phase—match those shared inputs. A separately captured editor-vs-export pixel-diff suite remains a production-integration prerequisite; this prototype does not claim pixel identity across browser builds.

Cancellation was exercised against an active 900-frame render at 10%: Ctrl+C returned non-zero, created no partial MP4, and an ownership-filtered process inspection found no remaining exporter Chrome or FFmpeg process. No broad Chrome kill was used.

## F. Performance

Bundle build is outside the export hot path. Measured bundle builds were 20.385s cold and 3.239–5.083s warm. Short 4-second, 1080×1920, 30 FPS tests reused the identical bundle:

| Variant | Browser startup | Select composition | Render | Bytes |
|---|---:|---:|---:|---:|
| New browser, c1, veryfast | 0.128s | 0.477s | 13.452s | 2,437,931 |
| Reused browser, c1, veryfast | 0s | 0.502s | 14.115s | 2,437,931 |
| Reused browser, c2, veryfast | 0s | 0.383s | 12.451s | 2,437,931 |
| Reused browser, c1, superfast | 0s | 0.385s | 14.561s | 5,604,791 |

On this host, c2 improved the c1 reused run by 11.8%; `superfast` was slower in this small sample and increased bytes 2.30×, so it is not a justified default. Browser reuse saves about 0.13s startup but does not materially change render time. Baseline stays c1/veryfast; c2 is a deployment benchmark candidate. The cache is capped at 512 MiB.

The representative Remotion render completed in 595.602s. `selectComposition` took 0.557s and browser startup 0.130s; the terminal progress event reported `renderedDoneIn=593.167s` and `encodedDoneIn=2.354s`. An external descendant-process sampler, started at 35% progress, observed a peak aggregate working set of 2,488.6 MiB and peak whole-host CPU of 45.9% on 8 logical processors. Because sampling began after startup, the memory value is an observed lower bound rather than a guaranteed whole-run peak.

The repository's measured legacy sparse 180-second/118-caption Case B completed in 288.580s (153.840s rendering, 118.283s encoding, 3,939,030 bytes). Its peak RAM field is null because Windows does not provide the Linux RSS collector used by that exporter. Remotion was 2.06× slower than that measured legacy sparse run. This is a shape-matched comparison (180s, 1080×1920, 30 FPS, 118 chunks), not an exact-source comparison, so its output-byte delta is not meaningful.

An exact 30-second comparison was attempted twice with `legacy_benchmark.py`, using the same moving source and caption document as Remotion. The packaged `/render.html` returned its assets but never set the renderer-ready signal and timed out under both a static server and the backend's own server; the Next development route also failed to finish compilation in the bounded validation window. Therefore no exact legacy number is reported or fabricated. The valid Remotion side of that exact fixture is 102.988s. Restoring a current packaged legacy render artifact is required for a fair exact A/B rerun.

## G. Problems and limits

- Remote signed URL/range/CORS behavior cannot be certified without a live signed CapInsta asset. The contract supports it without disabling browser security; production should prefer per-job localization.
- `<Video>` does not support reverse playback. The contract rejects it instead of faking it.
- The Windows host cannot supply the legacy Linux peak-RSS metric, and Docker/KVM2 performance can differ materially.
- The prototype Dockerfile was inspected but the image size could not be measured because the local Docker Desktop Linux daemon was unavailable. Image build and size recording remain a deployment gate.
- `superfast` did not improve the tested workload. PNG intermediate frames are required here to guarantee final `yuv420p`; Remotion's JPEG intermediate produced deprecated `yuvj420p` in an early diagnostic output.
- Independent editor/export screenshot pixel diffs and live private-media tests remain open.

## H. Production integration plan (not implemented)

```text
processing_jobs
      |
capinsta-worker-export claims durable job
      |
download/localize signed source into <temp>/capinsta-remotion/<job-id>
      |
Rust-authoritative project/EDL -> CapInstaRemotionPropsV1
      |
long-lived worker browser + prebuilt Remotion bundle -> renderMedia
      |
FFprobe gate -> upload -> ready/download
      |
finally cleanup job workspace; close browser on worker shutdown
```

Progress events map into existing job progress, secrets are redacted, cancellation calls the render-owned cancel signal, and legacy remains the default/rollback engine until shadow renders pass. The next phase should add a worker-only engine switch, signed-media integration tests, Linux resource limits/metrics, editor pixel-diff fixtures, and staged shadow comparison. It should not remove the legacy engine until those gates and licensing are resolved.

## I. Performance and isolation phase 2

### Isolation

Benchmark entry points now fail closed unless `CAPINSTA_ENV=benchmark` is explicit. They reject inherited database, Supabase, R2, AWS, and S3 configuration unless the exact manual mutation override is supplied. Python benchmark paths are forced under a disposable benchmark root with a local SQLite path; the backend benchmark lifespan skips orphan-job recovery, runtime cleanup, project retention, storage retention, and the operational mirror. The phase-2 runs did not start the production backend, use a production database, call remote storage, or run retention. The exact legacy A/B was not retried because its current render page remains unavailable and starting a non-isolated backend is forbidden.

The tracked `benchmark_export_pipeline.py` and `legacy_benchmark.py` now configure temporary roots before importing backend settings. The isolated TypeScript runner requires a benchmark marker/root and rejects external credentials. Python and TypeScript guard tests cover missing mode, unsafe external configuration, and a safe disposable configuration.

### Measured breakdown

The prebuilt bundle was reused for every hot render. The phase-2 bundle build took 25.344s separately; a later warm build took 1.947s. Neither is included in `renderMedia` measurements.

| 180-second run | Browser | Select | Media prepare | Frame render | Encode | Mux | `renderMedia` | End-to-end | Peak tree memory | Bytes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Phase 1 reference | 0.130s | 0.557s | not recorded | 593.167s | 2.354s | not recorded | 595.602s | 595.602s | 2,488.6 MiB observed | 203,850,456 |
| Phase 2 selected, reused after matrix | 0s | 0.509s | 0.134s | 672.891s | 1.998s | 0.051s | 674.945s | 676.203s | 2,137.2 MiB | 89,521,611 |
| Phase 2 fresh-browser confirmation | 0.130s | 0.454s | 0.096s | 704.929s | 2.746s | 0.044s | 707.725s | 709.047s | 2,008.6 MiB | 89,521,611 |

The best phase-2 final regressed 13.53% versus phase 1; the fresh confirmation regressed 19.05%. The two byte-identical phase-2 outputs differed by 4.86% in time, showing meaningful sustained-host/run-order variance. Frame rendering consumed more than 99% of `renderMedia`; media preparation, encoding, and muxing are not the bottleneck. Parallel encoding was active in every run. The final confirmation averaged 8.71% and peaked at 42.70% of whole-host CPU across eight logical processors. One matrix peak above 100% was rejected as Windows enumeration jitter instead of being reported as real.

### 30-second tuning matrix

All rows used 1080x1920, 30 FPS, standard CRF 23, AAC, the same captioned fixture, a prebuilt bundle, and parallel encoding. Memory is aggregate owned-process working set.

| Variant | `renderMedia` | Render done | Encode done | Peak MiB | Avg host CPU | Bytes | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| PNG, c1, veryfast, 512 MiB, new browser | 99.449s | 98.967s | 0.464s | 2,062.9 | 8.81% | 14,867,058 | valid |
| PNG, c1, veryfast, 512 MiB, reuse 1 | 110.452s | 109.764s | callback omitted | 1,862.4 | 8.80% | 14,867,058 | valid |
| PNG, c1, veryfast, 512 MiB, reuse 2 | 133.474s | 132.643s | 0.801s | 1,863.7 | 9.62% | 14,867,058 | valid |
| PNG, c1, veryfast, 512 MiB, reuse 3 | 133.619s | 132.923s | 0.671s | 1,892.9 | 9.43% | 14,867,058 | valid |
| JPEG 80, c1, veryfast, 512 MiB | 88.585s | 87.320s | 1.231s | 1,773.9 | 9.26% | 19,742,968 | rejected: yuvj420p |
| PNG, c2, veryfast, 512 MiB | 135.307s | 134.456s | 0.819s | 2,110.8 | 12.74% | 14,998,093 | valid |
| PNG, c2, superfast, 512 MiB | 120.865s | 120.157s | 0.684s | 2,062.2 | 12.94% | 33,791,597 | valid |
| PNG, c2, veryfast, 1,024 MiB | 126.611s | 125.448s | 1.129s | 2,108.3 | 12.87% | 15,011,479 | valid |
| PNG, c2, veryfast, 2,048 MiB | 131.410s | 130.749s | 0.637s | 2,103.7 | 12.98% | 14,996,229 | valid; CPU peak rejected |

JPEG 80 was 10.92% faster than the fresh PNG c1 row and was not silently reduced below Remotion's documented default quality. It was rejected because Remotion 4.0.507 emitted deprecated `yuvj420p` despite explicit `pixelFormat: "yuv420p"`. PNG is therefore required for this contract, even though the composition itself does not require transparency.

On this host, c2 raised CPU and memory without improving the real 30-second composition. The official Remotion CLI benchmark on a separate four-second loopback/OffthreadVideo path reported c1=32.3897s and c2=22.8937s, but that path fell back after browser CORS rejection and is not authoritative for the same-bundle fixture. This is why the real composition matrix overrides the CLI's short-test preference.

`superfast` reduced the c2 sustained run relative to c2/veryfast, but was still slower than c1/veryfast and produced 2.25x as many bytes. Cache growth from 512 MiB to 1 or 2 GiB did not produce a dependable win and did not lower process-tree memory. Browser reuse saved only about 0.13s of startup and sequential runs slowed substantially; one browser per worker remains simpler operationally, but reuse is not a claimed single-export acceleration.

### Quality, media, and profile audit

The Remotion quality map exactly matches the legacy headless exporter: draft=28, standard=23, high=18, best=16 (with fast/balanced aliases). The selected phase-2 output used CRF 23, x264 `veryfast`, 3,652,959 bps video, 317,374 bps audio, and 3,977,559 bps overall. FFprobe exposed no encoder tag. The phase-1 file was 9,057,336 bps overall, but its structured result did not record the x264 preset, so the byte difference is not attributed to a specific setting. The controlled matrix shows that `superfast` creates the same order of file-size increase.

Same-bundle localized media produced zero `onDownload` bytes and 0.096-0.262s preparation times, so networking/cache is not the bottleneck. The official CLI exercise used a disposable loopback HTTP source and OffthreadVideo fallback. A signed remote URL was not available, so a fair signed-remote-versus-localized comparison remains unmeasured; no number is invented. Production should still localize by byte-copy/download once, without a lossy re-encode.

Remotion's returned slow-frame data was added to structured results. A controlled four-second ordinary caption render took 12.792s; premium Skyline took 13.809s (+7.95%). Both concentrated their ten slowest frames in frames 0-9: frame 0 was 525ms ordinary and 602ms premium, while later listed frames were about 81-111ms. No slow-frame spike correlated with active-word changes, gradient, reveal, blur, glow, or sweep transitions. Static code inspection found that style normalization, active-caption/word lookup, and layout/lockup construction occur in the shared renderer, while its outer adapter already memoizes style and caption conversion. Since captioned/source-only and ordinary/premium measurements do not identify these computations as the dominant cost, no speculative memoization or visual-effect removal was applied.

### Final validation and decision

The phase-2 output passed FFprobe as H.264/yuv420p, 1080x1920, 30 FPS, 5,400 frames, 180.000s video, and AAC audio. Consecutive frames 100-102 had distinct hashes; `freezedetect` found no frozen interval. Frames at output 1s, 90s, and 179s visibly contained moving burned source timestamps and ordinary active-word captions with no chroma/green overlay artifact. Audio pulse/silence boundaries repeated at one-second intervals through the inspected section. An ownership-filtered process check found zero remaining exporter Chrome, FFmpeg, or Node processes. Existing correctness coverage for all eight premium presets, EDL cuts/repeats, 0.5x/1x/2x retiming, and cancellation remains passing.

Recommended KVM2-oriented settings, if further isolated tests continue, are: prebuilt/reused bundle; PNG; CRF 23 for standard; x264 `veryfast`; concurrency 1; 512 MiB media cache; parallel encoding enabled; one browser per worker; localized source media. This is the lowest-risk measured configuration for 2 vCPU/8 GB, not a production approval.

**Decision: KEEP OPTIMIZING.** Do not integrate, switch the default engine, remove legacy, or begin durable-worker work. Renderer settings alone did not produce a repeatable improvement, and both final phase-2 runs remained in the 11-12 minute range. The next performance investigation should target browser/frame-generation behavior on the actual Linux KVM2 environment while preserving the clean Remotion architecture; it must not recreate sparse screenshots.

Machine-readable evidence: `apps/remotion-exporter/benchmark-results/performance-phase2.json`.
