# CapInsta Configuration Regression Audit

Generated from:

- Reference backup: `G:\Huygen Studios\side projects\stable versions\Huygen-Caps-main-v4\capinsta-production-main`
- Current worktree: `F:\CapInsta\capinsta-production-editor`

## Summary

The 10 timing preset definitions were unchanged, but current resolver defaults and env mappings changed resolved behavior after preset resolution.

Restored drift:

| Parameter | Reference | Drifted current | Restored current | Owner |
| --- | ---: | ---: | ---: | --- |
| `performance.stableTsMaxAudioSeconds` | `45.0` | `120.0` | `45.0` | `backend/ai_pipeline/pipeline_config.py` |
| `quality.maximumEstimatedWordRatio` | `null` | `0.10` | `null` | `backend/ai_pipeline/pipeline_config.py` |
| `quality.maximumDeterministicFallbackRatio` | absent | `0.05` | absent | removed |
| `quality.minimumRealTimedWordCoverage` | absent | `0.90` | absent | removed |

## Calibrated Parameters

All calibrated behavior must originate from the versioned preset registry and typed resolver.

| Area | Parameters | Reference/current owner | Preset-owned | User override | Persisted snapshot |
| --- | --- | --- | --- | --- | --- |
| Stable Timestamp | enabled, model, device, min match coverage, word-ratio bounds, order fallback, max audio seconds | `backend/ai_pipeline/timing_presets.py`, `backend/ai_pipeline/pipeline_config.py` | yes | only allowed preset fields | yes |
| WhisperX/alignment | provider, WhisperX enabled, retry count | `backend/ai_pipeline/pipeline_config.py` | yes | only allowed preset fields | yes |
| Silero/VAD | Silero enabled, speech threshold, speech/silence duration, padding, pause threshold | `backend/ai_pipeline/pipeline_config.py` | yes | only allowed preset fields | yes |
| Audio chunking | VAD enabled, target/max seconds, padding, legacy windows, fade | `backend/ai_pipeline/pipeline_config.py` | yes | only allowed preset fields | yes |
| Caption chunking | target/max/min words, chars, duration, pause split, merge gap, phrase hold | `backend/ai_pipeline/pipeline_config.py` | yes | only allowed preset fields | yes |
| Quality policy | provider timestamp coverage, segment-derived/estimated allowance, optional legacy max estimated ratio | `backend/ai_pipeline/pipeline_config.py` | yes | only allowed preset fields | yes |
| Provider/runtime | provider, model, timestamp strategy, provider options | `backend/server/transcription_control.py` | selected catalog + preset compatible | admin config only | yes |
| Export render | render URL, render token, page timeout, sparse render operational settings | `backend/server/headless_export.py`, `backend/server/settings.py` | no, operational only | env/deployment | job metadata/diagnostics |

## Direct Environment Reads

Allowed infrastructure/capability reads remain in server/runtime code: secrets, provider keys, database URLs, cache paths, FFmpeg paths, worker limits, export storage paths, and build metadata.

Caption-calibration reads are centralized in `backend/ai_pipeline/pipeline_config.py` for compatibility with existing configuration rows. Current-only hidden env gates were removed from resolver mapping and `.env.example`.

Important remaining direct reads to keep classified:

| File | Classification | Notes |
| --- | --- | --- |
| `backend/server/transcription_control.py` | secrets/provider bootstrap | Chooses env bootstrap provider when DB config is unavailable. |
| `backend/ai_pipeline/transcriber.py` | provider secrets/timeouts | Provider execution; timeout comes from stored snapshot when present. |
| `backend/ai_pipeline/sync/stable_refine.py` | runtime capability/cache fallback | Execution receives resolved config from snapshot; fallback envs are legacy compatibility. |
| `backend/ai_pipeline/timing.py` | legacy default and runtime tooling | `DEFAULT_PAUSE_SPLIT_THRESHOLD` remains legacy; pipeline path passes resolved preset values. |
| `backend/server/headless_export.py` | export operational settings | Render URL/token/timeouts/FFmpeg are deployment concerns, not caption calibration. |

## Behavior Changes Fixed

1. Presets were unchanged but resolved behavior changed because global defaults were injected after preset resolution.
2. Client heartbeat continued because `capinstaServerJobId` remained in project metadata after terminal backend completion.
3. Provider timing was treated all-or-nothing; now valid provider chunks can remain native while non-native chunks are marked/repaired individually by the normalizer path.
4. Forced alignment no longer overwrites deterministic fallback words as Stable TS/realigned.
5. Export readiness now waits on `window.__CAPINSTA_RENDER_STATE__` and reports structured diagnostics instead of raw `Page.wait_for_function` timeout text.

## Tests And Benchmarks

Targeted tests run:

- `bun test apps/web/src/capinsta/jobPolling.test.ts apps/web/src/capinsta/captionJobLifecycle.test.ts`
- `PYTHONPATH=backend python -m pytest backend/tests/test_pipeline_config_and_timing_policy.py backend/tests/test_timing_presets.py backend/tests/test_final_timing_quality_gate.py -q`
- `python -m py_compile backend\ai_pipeline\pipeline_config.py backend\ai_pipeline\timing_presets.py backend\ai_pipeline\sync\final_quality_gate.py backend\ai_pipeline\main.py backend\server\headless_export.py backend\server\transcription_control.py`

Benchmarks were limited to non-media unit and parity verification in this pass. The code now records export performance fields already present in `ExportPerformanceMetrics`, and caption timing reports include source counts, estimated counts, real-timed counts, alignment coverage, and quality state for production measurement.
