# Troubleshooting

## Backend Unreachable At 127.0.0.1

In production, the browser must not call `127.0.0.1` or `localhost`. That points to the user's machine, not Render.

Fix:

- Single Docker service: leave `NEXT_PUBLIC_API_URL` blank.
- Split services: set `NEXT_PUBLIC_API_URL` to the backend Render HTTPS URL.
- Check `/health`.

## Render Port Issue

Symptom:

```text
No open ports detected
```

Fix:

- Bind to `0.0.0.0`.
- Use Render's `PORT` env var.
- Do not use `uvicorn --reload` in production.

The Docker CMD already does this:

```sh
uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-10000}
```

## CORS Issue

Symptoms:

- Browser console CORS errors.
- API works in curl but not from frontend.

Fix:

- Add frontend URL to `CORS_ORIGINS`.
- Do not use `*` with credentials.
- For same-origin Docker deployment, CORS is usually not involved.

## Generate Captions Failed

Check:

- `/health`
- backend logs,
- STT provider key,
- uploaded file type,
- `MAX_UPLOAD_SIZE_MB`.

Common fixes:

- Set `STT_PROVIDER=auto`.
- Add `SARVAM_API_KEY`, `OPENAI_API_KEY`, or `GROQ_API_KEY`.
- Use MP4/MOV.

## Chars Per Subtitle Does Not Immediately Change Rows

This is expected. Chars per subtitle controls chunk length and requires a rebuild.

Fix:

- Move the Chars per subtitle slider.
- Click `Rebuild Subtitles`.
- The app rebuilds from the saved aligned transcript, not from already-edited caption rows.

If Rebuild Subtitles is disabled or shows an error, generate subtitles first so `transcriptSegments` exists.

## Subtitle Row And Timeline Chunk Are Out Of Sync

Rows and timeline chunks share the same caption id. If they appear out of sync:

- Click the subtitle row again; preview should seek to the row start.
- Click the matching timeline chunk; the row should highlight.
- If timing looks stale while editing a timestamp, blur the time field so the value commits.

Timeline trimming writes through `updateCaption`, so row start/end fields refresh after the trim completes.

For speaker/caption synchronization mismatch or speed drift, use the Caption Editor `Timing & Sync` panel:

- `Preview Sync` tests global offset/skew without saving.
- `Apply Manual Sync` persists corrected timings and regenerates SRT/VTT.
- `Auto Fix Sync` compares captions with FFmpeg speech activity and applies only when confidence is high.
- `/api/jobs/{jobId}/timing-debug` shows stable-ts coverage, auto-sync quality, suspicious words, first/last word timing, and activity ranges.

Default Render deployment does not install stable-ts, WhisperX, Silero, torch, or torchaudio. This keeps deploys reliable. For high-quality local word refinement, install `requirements-optional-ai.txt` on a stronger worker and set `ENABLE_STABLE_TS=true`.

## Caption Gap Still Shows After A Timing Fix

Backend timing fixes do not rewrite captions already loaded in the browser or stored under an old job id.

Fix:

- Restart the backend after code changes.
- Refresh the frontend.
- Upload the source video again or generate a new caption job.
- Open `/api/captions/jobs/{jobId}/timing-debug` for the new job id.
- Check `chunkAudit`; old jobs will not contain the latest audit fields.

## Background Or Outline Controls Do Not Show In Export

Preview and export read `captionStyleConfig`.

Check:

- Make sure you changed controls in the right Caption Style panel.
- Use MP4 export with burned captions enabled.
- Re-export after style edits.
- For captions-only export, verify the export mode background is not hiding the caption style.

## Export Failed

Check:

```text
/health/export
```

Look at:

- `ffmpegAvailable`
- `ffprobeAvailable`
- `tempDirWritable`
- `exportDirWritable`
- `rendererAvailable`
- `chromium_launch`

The frontend should show:

```text
Export failed during <stage>: <error>
```

If it only shows a generic network error, check API URL and backend health.

## Render 502 During Export

Symptom:

```text
Starting frame capture... 5%
502
```

Root cause:

- Long synchronous MP4 exports can outlive Render/proxy request limits or crash the worker under memory pressure.

Production fix in this repo:

- The UI starts a background export with `POST /api/export/jobs`.
- It polls `GET /api/export/jobs/{jobId}` for `queued`, `running`, `completed`, or `failed`.
- `MAX_CONCURRENT_EXPORTS=1` prevents multiple Chromium/FFmpeg exports from running at once.
- `MAX_EXPORT_DURATION_SECONDS=300` rejects unexpectedly huge exports with a clear staged error.

Check Render:

- Open `/health`; the service should remain `ok` after a failed export.
- Open `/health/export`; confirm `ffmpegAvailable`, `ffprobeAvailable`, `rendererAvailable`, `chromium_launch`, and writable temp/export dirs.
- Check `activeExports`, `queuedExports`, and `maxConcurrentExports`.
- Inspect Render logs for `export_job_failed`, `headless_launch`, `render_frames`, `ffmpeg_encode`, or memory/restart messages.
- If memory is low, reduce resolution/FPS/duration or upgrade the Render plan.

## FFmpeg Not Found

Local fix:

- Install FFmpeg.
- Add FFmpeg to PATH.
- Optionally set `FFMPEG_PATH`.

Docker/Render fix:

- Confirm the Docker build installed `ffmpeg`.
- Check `/health/export`.

## FFprobe Not Found

FFprobe ships with FFmpeg in most installs. Install FFmpeg fully and make sure `ffprobe` is on PATH.

## Download URL Not Working

The backend serves exports from:

```text
/exports/<filename>
```

Fix:

- Confirm export response includes `downloadUrl`.
- Confirm the file exists in `EXPORT_DIR`.
- Do not restart the Render instance before downloading; disk is ephemeral.

## Modern Minimalist Shows A Black Rectangle

Expected default behavior is transparent background with white progressive text only.

Check:

- Select `Modern Minimalist Build` from Effects again to reapply current preset defaults.
- In Caption Style, keep Background disabled unless you intentionally want a box.
- Keep Background Shadow disabled unless Background is enabled.
- Text shadow is optional and should come from Universal Border & Shadow; it follows glyphs and should not create a rectangular block.
- Re-export after changing style controls because preview and export read the same caption style config.

## API URL Points To Localhost In Production

Fix:

- Remove `NEXT_PUBLIC_API_URL` for the single Docker service.
- If split deployment, set it to the backend Render URL.
- Rebuild frontend after changing public env vars.

## Temp Or Export Dir Not Writable

Fix:

- Set `TEMP_DIR=/tmp/huygen-caps`.
- Set `UPLOAD_DIR=/tmp/huygen-caps/uploads`.
- Set `EXPORT_DIR=/tmp/huygen-caps/exports`.
- Check container permissions.

## STT Key Missing

Caption generation requires at least one provider key:

- `SARVAM_API_KEY`
- `OPENAI_API_KEY`
- `GROQ_API_KEY`

`/health` reports which keys are configured without exposing values.

## Docker Build Fails

Common causes:

- Docker cannot download Python or Node dependencies.
- Playwright Chromium install fails.
- Not enough disk or memory.

Try:

```powershell
docker build --no-cache -t huygen-caps .
```

Then inspect the failing layer in the logs.
