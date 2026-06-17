# Export Pipeline

Huygen Caps supports full-video MP4 export and captions-only MP4 export.

## Frontend Flow

The Export modal starts a background MP4 export job through `startHeadlessExportJob` in `frontend/src/lib/api.ts`.

The start request sends:

- captions JSON,
- active caption theme,
- caption style config,
- output width/height,
- FPS,
- quality/bitrate settings,
- audio setting,
- export mode,
- duration and duration source,
- captions count and visible track count,
- source caption job ID.

The backend returns quickly:

```json
{
  "success": true,
  "jobId": "export-job-id",
  "statusUrl": "/api/export/jobs/export-job-id",
  "message": "Export started"
}
```

The frontend polls `statusUrl` every 1-2 seconds. When the job completes it resolves `downloadUrl` against the backend base URL and shows a Download MP4 button.

## Backend Route

```text
POST /api/export/jobs
GET /api/export/jobs/{export_job_id}
```

The background job routes are in `server/api/export_jobs.py`. Headless rendering is in `server/headless_export.py`.

The older `POST /api/jobs/{job_id}/export` route remains as a compatibility path, but production UI uses job polling so Render does not have to keep a long POST request open.

Status response:

```json
{
  "jobId": "export-job-id",
  "status": "queued",
  "stage": "frame_capture",
  "progress": 5,
  "message": "Starting frame capture...",
  "downloadUrl": null,
  "error": null
}
```

Completion response:

```json
{
  "jobId": "export-job-id",
  "status": "completed",
  "stage": "completed",
  "progress": 100,
  "downloadUrl": "/exports/file.mp4",
  "filename": "file.mp4",
  "bytes": 123456
}
```

## Stages

Failures are surfaced as:

```json
{
  "success": false,
  "stage": "render_video",
  "error": "specific actionable message"
}
```

User-facing message:

```text
Export failed during <stage>: <error>
```

Public stages:

- `validate_request`
- `validate_project`
- `determine_duration`
- `resolve_media`
- `prepare_render_input`
- `render_video`
- `write_output`
- `create_download_url`
- `completed`

## Full Video Export

Full video export requires the uploaded source video for the job.

FFmpeg inputs:

1. source video,
2. PNG caption frames piped from Playwright screenshots.

The source video is scaled/padded to the target dimensions, then caption frames are overlaid.

## Captions-Only Export

Captions-only export does not require source video duration. It uses the duration resolved by the editor, usually the last caption end time.

FFmpeg input:

1. PNG frames from the render page.

Optional audio is disabled automatically if the source media file is missing.

## Modern Minimalist Export Safety

`Modern Minimalist Build` renders through the same `CaptionRenderer` used by Program Monitor preview and timeline playback.

- Headless export advances by frame with `currentTime = frame / fps`.
- A caption chunk is active only during `caption.start <= currentTime < caption.end`.
- A word is visible only after `word.start`, and previous words remain visible until the chunk ends.
- The preset defaults to transparent background, no container shadow, no backdrop filter, no stroke, and no rectangular blur/box artifact.
- Optional text shadow is applied with CSS `text-shadow` on word spans, so it follows glyphs instead of the caption container.
- Font stacks use Inter with safe system fallbacks so Render/Linux export does not depend on a local Windows-only font.

Production smoke test:

1. Generate captions.
2. Select `Modern Minimalist Build`.
3. Export `Full video with visible tracks`.
4. Export `Captions-only on solid background`.
5. Confirm both MP4 files are downloadable and non-empty, and the text build matches preview.

## Duration Detection

Frontend duration priority lives in `determineExportDuration`:

1. custom export duration,
2. captions-only mode: captions duration when selected or as fallback,
3. timeline clip end,
4. imported media metadata duration,
5. caption end times,
6. sequence/playback duration,
7. fail with a specific message.

Backend accepts `duration_override`. If not provided, FFprobe is the fallback for source video duration.

## Output Serving

MP4 files are written to `EXPORT_DIR` and served by FastAPI static files:

```text
/exports/<filename>
```

Files are not deleted immediately after export. Runtime cleanup removes old files based on `RUNTIME_CLEANUP_HOURS`.

## Troubleshooting

Check:

```text
/health/export
```

Look for:

- `ffmpegAvailable`
- `ffprobeAvailable`
- `tempDirWritable`
- `exportDirWritable`
- `rendererAvailable`
- `chromium_launch`

If the frontend shows an HTML/404 error, it is calling the frontend server instead of FastAPI. Check `NEXT_PUBLIC_API_URL` and `/health`.
