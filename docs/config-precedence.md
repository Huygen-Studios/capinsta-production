# Caption Configuration Precedence

New caption jobs use one canonical path:

1. Versioned timing preset registry: `backend/ai_pipeline/timing_presets.py`
2. Selected `timingPresetId`
3. Validated explicit allowed job/admin override
4. Typed `CaptionPipelineConfig`: `backend/ai_pipeline/pipeline_config.py`
5. Immutable job snapshot: `backend/server/transcription_control.py`
6. Pipeline execution from the stored snapshot

## Rules

- Preset values own Stable Timestamp, WhisperX, Silero, VAD, chunking, alignment, fallback, pause, and timing quality calibration.
- `.env` must not silently replace calibrated caption behavior.
- Environment variables are allowed for secrets, provider bootstrap, database/storage/cache paths, FFmpeg, worker ceilings, build metadata, and export operational settings.
- Existing historical snapshots stay readable through `coerce_snapshot`.
- New serialized snapshots include:
  - `preset_id`
  - `preset_version`
  - `pipeline_options`
  - `resolved_pipeline_options`
  - `pipeline_option_sources`
  - `resolved_config_hash`
  - `runtime_capabilities`

## Rollback

Fast rollback flags:

- Disable Stable TS through the selected timing preset/admin configuration, not `.env`.
- Disable sparse export with `EXPORT_SPARSE_RENDER_ENABLED=false`.
- Route export to the configured render page by setting `EXPORT_PREFER_BUNDLED_RENDER=false`.

Do not roll back by adding global caption tuning constants to `.env.example`; that was the regression.

## Migration Notes

No stored job snapshot is rewritten. Jobs that already contain `resolved_pipeline_options` continue to run from that payload. Jobs without new metadata compute `resolved_config_hash` and `runtime_capabilities` when serialized again.

## Verification Commands

```powershell
$env:PYTHONPATH='backend'; python -m pytest backend\tests\test_pipeline_config_and_timing_policy.py backend\tests\test_timing_presets.py backend\tests\test_final_timing_quality_gate.py -q
bun test apps/web/src/capinsta/jobPolling.test.ts apps/web/src/capinsta/captionJobLifecycle.test.ts
python -m py_compile backend\ai_pipeline\pipeline_config.py backend\ai_pipeline\timing_presets.py backend\ai_pipeline\sync\final_quality_gate.py backend\ai_pipeline\main.py backend\server\headless_export.py backend\server\transcription_control.py
```
