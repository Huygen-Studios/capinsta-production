# Remotion hybrid export evaluation

Date: 2026-08-09. Status: isolated prototype only. Production APIs, workers, deployment, database, legacy exporter, and the existing full-frame prototype are unchanged.

## Recommendation

**KEEP OPTIMIZING**

The hybrid architecture remains correct, but the constrained Linux container run is not fast enough for production worker integration. The accepted two-CPU configuration took 564.049s for a representative 180-second export, versus the approximately 288s historical legacy result. Production integration should wait for further overlay/compositing optimization and a real cloud KVM2 confirmation.

## Linux container and FFmpeg optimization phase

This phase used Docker Desktop's Linux engine with `--cpus=2`, `--memory=4g`, and one export job at a time. It validates the Linux image and cgroup behavior, but it is not a claim of testing on a real cloud KVM2 host; that final infrastructure check remains open.

### Image and hot path

- image: `capinsta-remotion-hybrid:linux-kvm2`, 414,583,204 bytes
- pinned build runtime: Bun 1.3.14; hot-path runtime: Node 22.23.2
- Remotion packages: 4.0.507; FFmpeg: Debian 5.1.9
- initial clean build: 336.488s; cold Docker Desktop startup: 7.090s
- Chromium Headless Shell, fonts, the Remotion browser bundle, and compiled CLI are baked into the image
- runtime performs no package installation, browser download, or Remotion bundle build
- Docker dependency/browser layers are separated from source layers so source-only rebuilds reuse them
- `--benchmark` fails closed unless `CAPINSTA_ENV=benchmark` and `CAPINSTA_BENCHMARK_ROOT` are set; inherited production credentials remain rejected

### 30-second x264 matrix, video without overlay

All rows use exact input seeking, two container CPUs, a 4GiB limit, H.264/yuv420p, and AAC.

| Preset | Threads | FFmpeg s | Peak MiB | Output MB |
|---|---:|---:|---:|---:|
| faster | auto | 60.681 | 633.1 | 21.82 |
| faster | 1 | 50.842 | 373.0 | 21.70 |
| faster | 2 | 41.810 | 423.2 | 21.70 |
| veryfast | auto | 31.013 | 570.7 | 19.77 |
| veryfast | 1 | 42.595 | 312.0 | 19.64 |
| **veryfast** | **2** | **23.600** | **360.7** | **19.64** |
| superfast | auto | 22.410 | 528.2 | 42.19 |
| superfast | 1 | 21.803 | 261.8 | 41.89 |
| superfast | 2 | 24.595 | 316.4 | 41.89 |

`superfast` saved at most 1.8s while more than doubling output size, so it was rejected. Auto threads consumed more memory, and one thread left CPU capacity unused. The selected encoder setting is `veryfast`, two threads.

### Representative 30-second rows

| Case | Remotion concurrency | Overlay s | FFmpeg s | Total s | Peak MiB |
|---|---:|---:|---:|---:|---:|
| solid + no overlay | 1 | 0 | 11.385 | 11.529 | 313.9 |
| video + ordinary | 1 | 101.362 | 46.193 | 161.849 | 820.2 |
| video + ordinary | **2** | **50.533** | **39.819** | **107.162** | **828.3** |

Concurrency 2 nearly halved browser overlay time without meaningful memory growth and is selected. Concurrency above 2 was intentionally not profiled because the worker has two CPUs. The no-caption bypass did not launch Remotion and emitted zero overlay files. The optional premium Linux row was not run because the shared preset TypeScript contract currently excludes the premium fixture IDs; the existing premium evidence remains Windows-only.

### FFmpeg native profile

FFmpeg `-benchmark` and `-progress pipe:1` metrics are captured in every result, including user CPU, system CPU, real time, max RSS, frame, FPS, speed, and output time. On the preserved 900-frame ordinary overlay sequence:

- source decode + cover scale/crop to null: 5.665s real, 141,428KiB max RSS
- PNG RGBA decode to null: 5.192s real, 136,900KiB max RSS
- source decode/scale + PNG decode + straight-alpha overlay to null: 27.879s real, 257,968KiB max RSS
- complete overlay FFmpeg stage: 49.228s real, 465,772KiB max RSS

PNG decoding itself is only about 5.2s. The approximately 17s incremental filter cost is alpha compositing and pixel-format conversion; final encode/audio/mux account for roughly another 21s. A new streaming system or alternate alpha codec is therefore not justified by this profile. The already-measured ProRes 4444 path remains slower and larger. Independent input cursors remain in the graph. On a four-cut/repeated-range EDL, explicit per-input seeking reduced FFmpeg from 42.128s to 30.564s (27.4%) with byte-identical output size.

### Correctness, resources, and contention

- Linux alpha audit passed on black, white, saturated pink, and dark blue; worst PSNR was 43.90dB, with explicit `rgba` + `alpha=straight`
- every measured MP4 passed FFprobe for H.264, yuv420p, 1080x1920, 30 FPS, exact frame count/duration, and AAC
- cgroup v2 `memory.peak` and `cpu.stat` now cover the whole container rather than only the Node parent
- a separate 0.25-CPU mock health service remained responsive during a two-CPU export: 75 requests, zero failures, 59.9ms p95; the single 1.307s maximum was an isolated startup outlier
- the contended export completed in 29.696s versus the best isolated 23.897s, so co-residency has a measurable cost but did not starve the service

### Selected 180-second Linux result

- configuration: two CPUs, 4GiB, export job concurrency 1, Remotion concurrency 2, full-rate PNG, x264 `veryfast`, x264 threads 2, exact input seeking
- frames/duration: 5,400 / 180.000s
- select composition: 0.727s
- overlay render: 298.296s
- FFmpeg: 252.512s wall; 476.284s user CPU; 13.759s system CPU; 914,284KiB FFmpeg max RSS
- total: 564.049s
- full-container peak: 1,536.87MiB; average quota CPU utilization: 86.4%
- overlay: 350,812,769 bytes across 5,400 PNG files
- final MP4: 92,518,802 bytes; H.264/yuv420p/AAC; verification passed
- output: `apps/remotion-exporter/artifacts/linux-kvm2/representative-180s.mp4`

The 4GiB limit has ample memory headroom, so a 3.5GiB limit should also be safe for this fixture. The result is nevertheless 1.96x the historical legacy time. The exact phase recommendation is therefore **KEEP OPTIMIZING**.

## 1. Hybrid architecture

```text
CapInsta project + authoritative EDL + caption document
                         |
                 isolated export plan
                         |
            +------------+------------+
            |                         |
   FFmpeg base visual          Remotion overlay only
   video or solidColor         captions/effects -> RGBA PNG
   EDL + retime + audio                 |
            +------------+------------+
                         |
              FFmpeg overlay alpha=straight
                         |
             one H.264/yuv420p encode + AAC
```

`CapInstaOverlay` contains only a transparent `AbsoluteFill` and the shared `CapInstaCaptionLayer`. It has no `<Video>`, source image, project background, audio, green background, or chroma filter. The old `CapInstaExport` composition remains for A/B work.

## 2. Base visual contract

The prototype adds only a compositor adapter, not a second timeline model:

```ts
type HybridBaseVisual =
  | { type: "video" }
  | { type: "solidColor"; color: string };
```

`video` reuses `CapInstaRemotionPropsV1.media` and the validated `EditDecisionListV1`. `solidColor` adds only the required `#RRGGBB`; duration, dimensions, FPS, audio, cuts, and retiming still come from the authoritative export/EDL fields. FFmpeg uses independent input cursors per EDL range to prevent repeated-range decoder buffering.

## 3. Alpha intermediate and semantics

The selected intermediate is a full-rate PNG sequence. Remotion's current `renderFrames()` documentation says PNG is required for an image sequence with alpha. Current transparent-video documentation also supports VP8/VP9 `yuva420p` and ProRes 4444/4444-XQ `yuva444p10le`; ProRes 4444 was measured, not assumed.

- PNG, 4s: overlay 10.347s, FFmpeg 2.603s, total 13.716s, 6,586,484 bytes.
- ProRes 4444, 4s: overlay/encode 21.766s, FFmpeg 2.164s, total 24.802s, 8,651,315 bytes.

PNG therefore won both time and disk in this fixture. Relevant primary references: [Remotion transparent videos](https://www.remotion.dev/docs/transparent-videos), [Remotion renderFrames](https://www.remotion.dev/docs/renderer/render-frames), [Remotion overlays](https://www.remotion.dev/docs/overlay), [PNG alpha representation](https://www.w3.org/TR/png-3/#6AlphaRepresentation), and [FFmpeg overlay filter](https://ffmpeg.org/ffmpeg-filters.html#overlay-1).

PNG stores unassociated/non-premultiplied color values, so FFmpeg is explicitly invoked with `overlay=alpha=straight`. Local `ffmpeg -h filter=overlay` confirmed this build supports `straight` and `premultiplied`, with straight as default. The explicit option prevents silent default drift.

## 4. Full-frame baseline and browser reduction

The same 30-second ordinary fixture's prior compliant full-frame reference was 99.449s in `renderMedia()` and 101.440s total. The hybrid video case spent 29.813s generating overlay frames and 53.486s total.

- Browser/frame-generation reduction: **70.02%**.
- End-to-end reduction: **47.27%**.
- Existing 180-second full-frame results: 595.602s, 676.203s, and 709.047s.
- Accepted 180-second hybrid: 378.733s, a 36.41%-46.59% reduction.

## 5. Full-rate 30-second matrix

All cases are 1080x1920, 30 FPS, 900 frames, H.264/yuv420p with AAC. Bundle time is excluded.

| Case | Remotion | Overlay s | FFmpeg s | Total s | Temp bytes | Peak MiB |
|---|---:|---:|---:|---:|---:|---:|
| video + ordinary | yes | 29.813 | 21.322 | 53.486 | 49,931,968 | 927.8 |
| video + premium Skyline | yes | 36.810 | 26.086 | 65.389 | 56,722,035 | 912.2 |
| video + no overlay | no | 0 | 14.214 | 16.527 | 0 | 617.4 |
| solid black + ordinary, telemetry rerun | yes | 37.973 | 19.326 | 60.000 | 49,921,875 | 787.0 |
| solid custom + premium Skyline | yes | 39.583 | 22.435 | 64.862 | 56,722,035 | 869.2 |
| solid dark + no overlay | no | 0 | 7.472 | 10.115 | 0 | 541.7 |

The original solid/ordinary one-second Windows CIM memory sample was invalid and is superseded by the five-second telemetry rerun shown above. Machine-readable evidence is in `apps/remotion-exporter/benchmark-results/hybrid-phase.json`.

## 6. Sparse overlay result

An experimental planner is restricted to the audited `word_highlight_box` renderer. It renders all entrance/active-word transform frames and hard-links only proven held states into a full-rate sequence; unknown and premium renderers fail closed. FFmpeg still consumes a 30 FPS overlay stream and the base always advances independently.

| Base | Timeline | States | Reduction | Remotion s | FFmpeg s | Total s | Unique temp bytes | Peak MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| video | 900 | 720 | 20% | 25.301 | 21.854 | 49.322 | 39,906,662 | 923.6 |
| solid | 900 | 720 | 20% | 30.482 | 18.905 | 52.837 | 39,894,833 | 792.4 |

Final-output PSNR versus full-rate was 40.40dB (video) and 42.47dB (solid). The speedup is too modest for the classification risk, so sparse mode is not selected.

## 7. Alpha and solid-color quality

The deterministic alpha fixture contains white text at 50% opacity, a translucent colored element, gradient, blur, glow, and shadow. It compares direct Chromium composition with transparent RGBA PNG plus FFmpeg straight-alpha composition:

- black: exact (infinite PSNR)
- white: 62.47dB
- saturated pink: 50.72dB
- dark blue: 43.92dB

No black/white/green fringe or clipped glow was observed in extracted frames. The PNG probe is `rgba`; alpha ranges from 0 through partial values to 255.

Decoded H.264 solid-color samples were also measured, rather than inferred:

- `#000000` -> `[0, 0, 0]`
- `#FFFFFF` -> `[255, 255, 255]`
- `#FF0066` -> `[254, 0, 101]`
- `#18233A` -> `[23, 32, 57]`

Maximum channel error was 3 after normal limited-range YUV420 encoding/decoding. All four no-caption color tests bypassed Remotion and retained AAC audio for the full authoritative four-second duration.

## 8. Video, EDL, audio, and motion correctness

Real MP4 coverage passed sequential cuts, reordered ranges, repeated ranges, 0.5x/1x/2x retiming, source offsets, cover scaling/cropping, exact output duration, and AAC audio. The 17.5-second EDL caption case and seven-second retiming case both passed FFprobe.

Permanent plan coverage requires independent input cursors for repeated EDL ranges. Frame MD5 evidence from the 180-second output proves continuous motion at ordinary frames 100/101/102, across the repeated-range boundary 899/900/901, and at 5397/5398/5399; all nine hashes differ. Overlay holds never control source cadence.

## 9. Ordinary and premium parity

The overlay calls the unchanged shared `CapinstaCaptionRenderer` with deterministic `frame / fps` time. Ordinary active-word/highlight/pop/bounce/entrance semantics, wrapping, alignment, and safe positioning therefore use the existing renderer. Full-rate output does not quantize animation.

All eight premium presets produced real four-second video-base hybrid MP4s with alpha blending and AAC:

`skyline_italic`, `ember_focus`, `citrus_signature`, `volt_matrix`, `ivory_signature`, `cobalt_script`, `mint_ink`, and `monument`.

No preset visual logic, typography, effects, or fonts were simplified.

## 10. Bypass, cancellation, cleanup, and isolation

Both 30-second no-overlay rows report `remotionInvoked: false`, zero overlay states, and zero overlay bytes. Chrome is opened only inside the overlay-required branch.

Abort-signal acceptance cancelled an active four-second overlay render, removed the partial MP4, stopped owned Chrome, and left the temp job list unchanged. Success and failure use `finally` cleanup. The workspace is `%TEMP%/capinsta-remotion-overlay/job-*`; debug preservation is explicit. Final inspection found no owned Node, Chrome, or FFmpeg process and no retained temp job.

Benchmark entry points retain `assertSafeBenchmarkEnvironment()`: `CAPINSTA_ENV=benchmark` and an explicit benchmark root are mandatory; production database, Supabase, R2, S3, retention, and cleanup configuration fail closed.

## 11. Representative 180-second result

The selected safe configuration was full-rate PNG, concurrency 4, video base:

- frames/duration: 5,400 / 180.000s
- overlay generation: 195.722s
- FFmpeg EDL/composition/final encode: 177.730s
- total: 378.733s
- unique overlay bytes: 300,086,443
- peak process-tree working set: 1,732.43MiB
- final MP4: 95,176,608 bytes
- output: H.264, yuv420p, 1080x1920, 30 FPS, AAC

An initial attempt exposed repeated-range buffering (about 7.2GiB FFmpeg working set) and was cancelled. Its partial output/temp files were removed. The independent-input-cursor fix reduced the accepted FFmpeg stage to about 1.48GiB observed working set and is regression-tested. A second 180-second solid run was not justified: the 30-second matrix already established base correctness and it would not change the remaining browser/FFmpeg decision.

## 12. Files, tests, outputs, and remaining risks

Prototype additions are confined to `apps/remotion-exporter` plus this report: overlay/audit compositions, hybrid FFmpeg planner/exporter, sparse experiment, benchmark/acceptance/alpha/color drivers, fixtures, tests, package scripts, and generated reports. Existing production export code is untouched.

Validation commands include `bun run typecheck`, `bun test src`, `bun run audit:alpha`, `bun run audit:solid-colors`, `bun run acceptance:hybrid`, `bun run benchmark:hybrid`, direct FFprobe/frame extraction, frame MD5, and the 180-second `bun run hybrid` acceptance run.

Important output paths:

- `apps/remotion-exporter/benchmark-results/hybrid-phase.json`
- `apps/remotion-exporter/artifacts/hybrid-matrix/`
- `apps/remotion-exporter/artifacts/hybrid-acceptance/report.json`
- `apps/remotion-exporter/artifacts/hybrid-alpha-audit/report.json`
- `apps/remotion-exporter/artifacts/hybrid-color-audit/report.json`
- `apps/remotion-exporter/artifacts/hybrid-representative-180s.mp4`
- `apps/remotion-exporter/artifacts/hybrid-validation/`

Remaining risks: Windows-only performance evidence; FFmpeg is now nearly half the 180-second total; sparse classification is intentionally narrow; private signed-media localization is not production-tested; project-audio behavior beyond the current source-audio contract needs worker-level validation; process-tree CPU averages on Windows CIM are diagnostic only; Remotion licensing and production Linux/KVM2 behavior remain gates.
