# Remotion hybrid export evaluation

Date: 2026-08-09. Status: isolated prototype only. Production APIs, workers, deployment, database, legacy exporter, and the existing full-frame prototype are unchanged.

## Recommendation

**KEEP PROTOTYPING**

The hybrid architecture is correct and substantially faster than full-frame Remotion, but the accepted 180-second run still took 378.733s. That beats the prior full-frame runs by 36.4%-46.6%, but remains slower than the approximately 288s historical legacy result and spends 177.730s in FFmpeg. Production integration should wait for Linux/worker measurements, FFmpeg EDL throughput work, private-media validation, and a stronger sparse-overlay policy.

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
