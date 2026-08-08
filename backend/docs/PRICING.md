# Pricing And Cost Model

This document is intentionally editable. Provider prices change, so fill in actual values from current Render, STT, storage, and bandwidth invoices before publishing pricing.

## Variables

| Variable | Meaning |
| --- | --- |
| `hosting_monthly` | Render monthly service cost. |
| `stt_cost_per_minute` | Speech-to-text cost per audio minute. |
| `render_compute_cost_per_minute` | Compute cost per rendered video minute. |
| `storage_cost_per_export` | Temporary or durable storage estimate per export. |
| `download_bandwidth_cost_per_export` | Bandwidth estimate per export download. |
| `platform_overhead_per_export` | Payment, logging, retries, failed jobs, support, and margin buffer. |
| `margin_multiplier` | Desired gross margin multiplier. Example: `2.0` for 50 percent gross margin. |

## Cost Per 1-Minute Reel

```text
base_cost_per_1_min_reel =
  stt_cost_per_minute
  + render_compute_cost_per_minute
  + storage_cost_per_export
  + download_bandwidth_cost_per_export
  + platform_overhead_per_export

price_per_1_min_reel =
  base_cost_per_1_min_reel * margin_multiplier
```

## Monthly Cost

```text
monthly_cost =
  hosting_monthly
  + expected_transcription_minutes * stt_cost_per_minute
  + expected_render_minutes * render_compute_cost_per_minute
  + expected_exports * (storage_cost_per_export + download_bandwidth_cost_per_export)
  + expected_exports * platform_overhead_per_export
```

## Suggested Plan Templates

| Plan | Target User | Included Usage | Notes |
| --- | --- | --- | --- |
| Free/Test | trial users | low export count, watermark optional | Good for validation, protect with rate limits. |
| Starter | solo creators | fixed monthly caption minutes and exports | Price above expected STT and render costs. |
| Pro | frequent creators | higher minutes, faster support | Add higher export limits and priority queue later. |
| Agency | teams | pooled minutes and exports | Consider seat limits and branded presets. |
| Pay-per-export | occasional users | charged by rendered MP4 | Useful for users who do not want a subscription. |

## Cost Controls

- Cap upload size with `MAX_UPLOAD_SIZE_MB`.
- Cap custom export duration.
- Offer lower bitrate defaults for free tiers.
- Clean old exports with `RUNTIME_CLEANUP_HOURS`.
- Add durable object storage only when needed.
- Track failed transcription and render jobs separately; failed jobs still cost compute.

## Data To Collect Before Final Pricing

- Average uploaded video length.
- Average transcription duration.
- Average MP4 render duration.
- Average export file size.
- Render plan CPU/RAM cost.
- STT provider invoice cost.
- Support/refund rate.
