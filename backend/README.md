# Huygen Caps

Huygen Caps is a short-form AI caption and video editor for creators. It uploads an MP4/MOV, transcribes speech with word-level timestamps, previews animated captions in the editor, and exports downloadable burned MP4s plus subtitle/transcript files.

Supported caption modes:

- Auto Mixed Indian: Telugu, Hindi, and English mixed naturally in the same sentence, rendered in Roman text
- English
- Hinglish
- Telgish / Teluglish: Telugu or Telugu-English mixed speech rendered in Roman letters, for example `nenu site ki vellanu`

The app is optimized for Instagram Reels, YouTube Shorts, and TikTok.

## Documentation

- [Local Setup](docs/LOCAL_SETUP.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Docker](docs/DOCKER.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Environment](docs/ENVIRONMENT.md)
- [Caption Workflow](docs/CAPTION_WORKFLOW.md)
- [Caption Timing](docs/CAPTION_TIMING.md)
- [Export Pipeline](docs/EXPORT_PIPELINE.md)
- [Pricing](docs/PRICING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Architecture

- `frontend/`: Next.js editor, media import, caption preview, SRT/JSON/MP4 export UI.
- `server/`: FastAPI upload/job/export API, SQLite job store, WebSocket progress.
- `ai_pipeline/`: audio extraction, STT provider abstraction, transcript normalization, word-level alignment, SRT/VTT rendering.
- `server/headless_export.py`: Playwright + FFmpeg frame export. It captures the same React caption component used in preview and burns it into the output video.

## Requirements

- Python 3.10+
- Node.js 18+
- FFmpeg and FFprobe on PATH, or `FFMPEG_PATH` set in `.env`
- A configured STT provider:
  - `STT_PROVIDER=auto` with one of the provider keys below
  - `STT_PROVIDER=groq_whisper` or `STT_PROVIDER=whisper` with `GROQ_API_KEY`
  - `STT_PROVIDER=openai_whisper` with `OPENAI_API_KEY`
  - `STT_PROVIDER=sarvam` with `SARVAM_API_KEY`

Sarvam is recommended for production Telgish/Teluglish because Saaras v3 supports Telugu (`te-IN`), word timestamps, and `translit` Roman output. See the official Sarvam STT docs: https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe

## Environment

Copy `.env.example` to `.env` and fill in the values:

```env
NODE_ENV=development
HOST=127.0.0.1
PORT=8000
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173
MAX_UPLOAD_SIZE_MB=500
MAX_CONCURRENT_EXPORTS=1
MAX_EXPORT_DURATION_SECONDS=300
TEMP_DIR=/tmp/huygen-caps
UPLOAD_DIR=/tmp/huygen-caps/uploads
EXPORT_DIR=/tmp/huygen-caps/exports
DB_PATH=/tmp/huygen-caps/database.sqlite
RUNTIME_CLEANUP_HOURS=24
NEXT_PUBLIC_API_URL=
RENDER_PAGE_URL=http://localhost:3000/render
STT_PROVIDER=auto
GROQ_API_KEY=
OPENAI_API_KEY=
SARVAM_API_KEY=
ALIGNMENT_PROVIDER=auto
ENABLE_WHISPERX=false
ENABLE_STABLE_TS=false
ENABLE_SILERO_VAD=false
PAUSE_SPLIT_THRESHOLD=0.30
DEFAULT_GLOBAL_CAPTION_OFFSET=0
FFMPEG_PATH=ffmpeg
```

`STT_PROVIDER=auto` chooses Sarvam first for Hinglish, Telgish, and Auto Mixed Indian when `SARVAM_API_KEY` is configured, then OpenAI Whisper, then Groq Whisper. Telgish and Auto Mixed Indian fail clearly if no Telugu-capable provider key is configured.

## Install

Backend:

```powershell
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m playwright install chromium
```

Frontend:

```powershell
cd frontend
npm install
```

## Run Locally

Backend:

```powershell
.\venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend:

```powershell
cd frontend
npm run dev
```

Open http://localhost:3000.

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/health/export
Invoke-RestMethod http://127.0.0.1:8000/api/health/timing
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/health/export
Invoke-RestMethod http://127.0.0.1:8000/health/timing
```

## Render Deployment

The production setup is a single Docker web service. Docker builds the Next.js editor as static files, FastAPI serves those files and the `/api/*` routes on the same Render origin, and the frontend uses relative API paths by default. This avoids deployed browsers trying to call `127.0.0.1`.

Deployment files:

- `backend/Dockerfile`: installs FFmpeg, Python dependencies, Playwright Chromium, packages the Next.js render artifact, and starts FastAPI on `$PORT`.
- `render.yaml`: blueprint for one Docker web service with `/health` as the health check.
- `.dockerignore`: keeps local media, venvs, node modules, logs, and secrets out of the image.

Render setup:

1. Create a new Blueprint or Docker web service from this repository.
2. Use repository root as the Docker context and `./backend/Dockerfile` as the Dockerfile.
3. Health check path: `/health`.
4. Add at least one STT key: `SARVAM_API_KEY`, `OPENAI_API_KEY`, or `GROQ_API_KEY`.
5. Keep `NEXT_PUBLIC_API_URL` blank for the single-service Docker deployment.
6. Set `STT_PROVIDER=auto` unless you need to force `sarvam`, `openai_whisper`, or `groq_whisper`.
7. Use `/tmp/huygen-caps` paths for `TEMP_DIR`, `UPLOAD_DIR`, `EXPORT_DIR`, and `DB_PATH`.

Build command: Docker uses the `Dockerfile`; no separate Render build command is needed.

Start command:

```sh
uvicorn server.main:app --host 0.0.0.0 --port $PORT
```

Local Docker smoke test:

```powershell
docker build -f backend/Dockerfile -t capinsta-backend .
docker run --rm -p 10000:10000 --env-file backend/.env capinsta-backend
```

Open http://localhost:10000 and check http://localhost:10000/health.

Export diagnostics are available at `/api/health/export` and `/health/export`. They report FFmpeg, FFprobe, Playwright package availability, Chromium launch status, the render page URL, and whether the export directory is writable.

Timing diagnostics are available at `/api/health/timing` and `/api/captions/jobs/{jobId}/timing-debug`. They report optional alignment provider availability, timing source counts, silence gaps, suspicious word timing, and the pause threshold used for chunking.

Render storage note: Render web service disk is ephemeral unless you add persistent storage. Huygen Caps stores uploads, temporary files, the SQLite job DB, and exports in `/tmp/huygen-caps` for the current running instance. Use S3/R2 or another object store before relying on long-lived uploaded media or exports.

## Generate Test

1. Import an MP4 or MOV.
2. Select `Auto Mixed Indian`, `English`, `Hinglish`, or `Telgish / Teluglish`.
3. Click `Generate Captions`.
4. Confirm the editor shows processing progress.
5. Confirm captions appear with word timings.
6. Open Export and download `Burned MP4`, `SRT Subtitles`, or `Transcript JSON`.

## Language Tests

English:

- Use an English MP4.
- Select `English`.
- Verify the backend receives `languageMode=english`.
- Verify word timestamps exist and the exported MP4 highlights spoken words.

Auto Mixed Indian:

- Use a Telugu-English or Telugu-Hindi-English mixed MP4.
- Select `Auto Mixed Indian`.
- Verify Roman output, not Telugu or Devanagari script.
- Verify English words remain readable.
- Verify word timestamps and burned MP4 export.

Hinglish:

- Use a Hindi-English mixed MP4.
- Select `Hinglish`.
- Verify Roman output, not Devanagari.
- Verify word timestamps and burned MP4 export.

Telgish / Teluglish:

- Use a Telugu-English mixed MP4.
- Select `Telgish / Teluglish`.
- Verify the request sends `languageMode=telgish`.
- Verify the backend accepts it.
- Verify output is Roman text, not Telugu script.
- Verify every visible word has start/end timing.
- Verify the burned MP4 uses animated word highlights.

## Transcript Normalization

All provider output is normalized into a shared transcript shape with:

- `languageMode`
- `provider`
- `romanized`
- `segments`
- `words` with `word`, `displayedWord`, `originalWord`, `start`, `end`, optional `confidence`, `languageHint`, and `timingSource`

Hinglish, Telgish, and Auto Mixed Indian detect Telugu (`U+0C00-U+0C7F`) and Devanagari (`U+0900-U+097F`) script. Native-script words are romanized while English words, names, numbers, and punctuation are preserved. If Romanization fails and native script remains, generation fails instead of outputting unreadable captions.

## Caption Chunking

Use the `Caption Chunking` controls in the editor to rebuild captions from existing word timestamps without re-running transcription.

- Defaults target smooth 4-word caption pages, with a maximum of 5 words, minimum of 2 words, 34 characters, 0.8s minimum duration, and 3.0s maximum duration.
- Max words per caption
- Target words per caption
- Min words per caption
- Max characters per caption
- Minimum and maximum caption duration
- Pause split threshold
- Merge small gaps
- Target reading speed
- Avoid single-word captions
- Balance line length

## Timing & Sync

The `Caption Editor` panel includes a `Timing & Sync` section for fixing sync without re-transcription.

- Global caption offset: shifts all captions from `-1.00s` to `+1.00s`.
- Selected caption offset: shifts the selected caption from `-0.50s` to `+0.50s`.
- Nudge selected caption buttons: `-0.10s`, `-0.05s`, `+0.05s`, and `+0.10s`.
- Selected start/end fields: manually edit one caption range.
- Word timing sensitivity, minimum word duration, maximum hold after word, and pause split controls rebuild chunks from saved transcript words.
- Reset Timing rebuilds from the preserved transcript segments.
- Snap to waveform peaks is exposed as a toggle, but waveform data is currently visual-only; precise onset snapping is a TODO.

Manual timing edits mark words as `timingSource=manual`. Preview and export both read the same caption `start`, `end`, and `words[]` values.

Caption timing uses original word timestamps as the source of truth. Caption chunks start on the first word, end on the last word plus a short hold, and are clamped before the next chunk so captions do not hang into the next phrase.

## Caption Editor

The `Caption Editor` panel shows every caption chunk in order with index, start time, end time, editable text, language, timing source, and warnings.

- Click a row to select that caption and seek the playhead to its start.
- Edit text directly in the row textarea; blur or `Ctrl+Enter` applies it.
- Same-word-count edits keep the original word timings and update `displayedWord`.
- Changed-word-count edits keep the caption start/end, distribute word timing inside the chunk, and mark the row for timing review.
- Reset restores the original transcript text for that row.
- Search and replace can update repeated spelling mistakes globally.
- Split and merge-with-next are available from each row.

## Caption Presets

Caption style cards are generated from a reusable preset registry and apply instantly in the Effects and Caption Style panels. The same renderer is used for Program Monitor preview, timeline playback, full-video export, and captions-only export.

- `Word Highlight Box`: default readable word highlight box.
- `Kinetic Fade`: smooth word reveal.
- `Attention Punch`: bold outline with active-word punch.
- `MrBeast Style`: 1-2 word chunks, all caps, heavy black stroke, deterministic tilt, smart green/yellow/red keyword colors, and frame-based mechanical pop.
- `Apple Cinematic`: premium centered words with opacity, upward movement, and blur reveal from word timestamps.
- `Modern Minimalist Build`: clean centered creator typography that builds a 3-5 word phrase progressively as each word is spoken.

Modern Minimalist no longer uses the old asymmetric anchor/support lockup. Words reveal from word-level timestamps, previous words stay visible until the caption chunk ends, and then the whole phrase clears before the next chunk. For example: `completely`, then `completely / change`, then `completely / change your life`.

Modern Minimalist defaults to huge bold white Inter text, centered in the sequence canvas, with no background rectangle, no container box-shadow, no stroke, and no heavy shadow. Optional text shadow applies to glyphs only, and optional background stays off unless the user enables it in Caption Style.

## Sequence Settings

Open `Sequence` settings from the toolbar to choose `9:16`, `16:9`, `1:1`, `4:5`, or a custom size/FPS. Saving sequence settings updates the Program Monitor canvas immediately. Export defaults to `Same as sequence`, so the selected sequence size and FPS flow into MP4 export unless the Export panel overrides them.

## Export Settings

The Export panel supports:

- `Full video with visible tracks`: renders source video plus burned captions using the selected resolution/FPS/quality settings.
- `Captions-only on solid background`: renders only the selected captions on a solid color background.

For captions-only export, choose a background color and duration source: captions, timeline, sequence, or custom duration. Full-video export resolves duration from timeline clips, media metadata, captions, or custom export settings and passes that duration to the backend so ffprobe is no longer the only source of truth.

After a successful MP4 export, the modal shows a `Download MP4` button with the rendered file ready to save.

The export API also verifies that FFmpeg created a non-empty file before returning the response. Successful exports include `X-Export-File`, `X-Export-Url`, and `X-Export-Bytes` headers, and production serves generated MP4s from `/exports/<filename>` for the lifetime of the current Render instance.

## Word Highlight Box

The default premium style is `Word Highlight Box`.

- Captions are chunked into short 2-6 word pages, preferring 4-5 words for fast Reels.
- All words in the active chunk remain visible.
- Inactive words use the configured text color.
- The currently spoken word uses the configured active word color, default `#FFD43B`.
- The caption sits inside a configurable dark rounded background.
- Active word timing is computed from word timestamps.
- Headless export advances by frame with `currentTime = frame / fps`.
- Preview and export use the same React caption component.
- Small provider/alignment overlaps are repaired before rendering and marked with a
  `*_repaired` `timing_source` in transcript JSON.
- If a caption has no word-level timestamps, the app shows:
  `Word-level timestamps are required for automatic word highlighting.`

Use the `Caption Style` panel to customize:

- Font family: Komika Axis, CCSignLanguage, Obelix Pro, Poppins, Inter, SF Pro Display, Helvetica Neue, Montserrat, Roboto, Oswald, Anton, Bebas Neue, Impact, Arial Black, Georgia, Arial.
- Font size, weight, letter spacing, line height, and uppercase mode.
- Text color and active word color.
- Active word scale, glow, animation strength, animation type, and speed.
- Background color, opacity, radius, padding, and shadow.
- X/Y position, safe area, alignment, and max width.

Fonts are resolved through shared fallback stacks so missing optional fonts do not crash export. To add a custom font legally, add the font file or package to the frontend, register it in `frontend/src/lib/captionStyleConfig.ts`, and use the same family name in preview and export.

## Preview/Export Consistency

- All caption presets render from `CaptionRenderer`.
- Headless export advances by frame with `currentTime = frame / fps`.
- Caption layout is clamped by the shared safety layer: max width 82%, max height 28%, safe margins 8%, balanced two-line wrapping, normal word breaking, and responsive font fitting.
- No preset uses `setInterval`, browser-only timers, or nondeterministic random values.
- Deterministic layout/tilt values are derived from caption and word IDs.
- Manual text and timing edits update the caption model used by both preview and export.

## Word Highlight Box Tests

Test 1:

- Upload an English reel.
- Generate captions.
- Select `Word Highlight Box`.
- Confirm the active word turns yellow exactly when spoken.
- Change active word color to green.
- Export MP4 and confirm it matches preview.

Test 2:

- Change font to Poppins, Montserrat, and Anton.
- Confirm preview and exported MP4 use the selected font.

Test 3:

- Change background color, opacity, radius, and padding.
- Confirm the box wraps text cleanly and export matches.

Test 4:

- Move caption X/Y position with sliders.
- Confirm the caption stays inside the safe area and export matches.

Test 5:

- Use longer caption text.
- Confirm chunking avoids long full-sentence paragraphs.

Test 6:

- Drag captions in the preview.
- Confirm all caption chunks move together.
- Export MP4 and confirm the same position.

Test 7:

- Upload Telugu-English or Hindi-English mixed speech.
- Confirm the transcript JSON has Roman `word` values and `originalWord` only when romanization changed the token.

## Caption Preset Tests

Timing offset:

- Generate captions.
- Adjust global offset and confirm active-word sync shifts earlier/later.
- Export and confirm timing matches preview.

Selected caption timing:

- Select one bad caption.
- Nudge by `+0.05s`.
- Confirm preview updates and export matches.

Caption text editing:

- Fix a spelling mistake in Caption Editor.
- Confirm the Program Monitor and timeline text update.
- Export and confirm the corrected spelling is used.

MrBeast Style:

- Select `MrBeast Style`.
- Confirm 1-2 word chunks, all caps, heavy outline, mechanical pop, and silence clearing.

Apple Cinematic:

- Select `Apple Cinematic`.
- Confirm words fade, slide, and blur in cleanly with no heavy stroke.

Modern Minimalist Build:

- Select `Modern Minimalist Build`.
- Confirm each word appears at its `word.start` time and previously spoken words remain visible until the chunk ends.
- Confirm the full phrase clears before the next caption chunk starts.
- Confirm there is no rectangular black shadow/box by default.
- Export full-video MP4 and captions-only MP4; both should match the Program Monitor.

Missing font:

- Select a preset whose exact font is not installed.
- Confirm fallback rendering works and export does not crash.

## Troubleshooting

Generate button does nothing:

- Confirm the backend is running on `http://127.0.0.1:8000`.
- In local dev, leave `NEXT_PUBLIC_API_URL` blank or point it to `http://127.0.0.1:8000`.
- In the single Docker Render deployment, leave `NEXT_PUBLIC_API_URL` blank so the editor calls same-origin `/api`.
- If frontend and backend are separate Render services, set `NEXT_PUBLIC_API_URL` to the public backend URL before building the frontend.
- Check the inline error in the Caption Editor.
- Check `GET /api/health`; it reports FFmpeg, FFprobe, provider key presence, storage paths, and render page URL.
- Run `.\venv\Scripts\python.exe -c "from server.main import app; print(app.title)"`.

CORS error:

- Use the default frontend/backend ports first: `3000` and `8000`.
- Confirm the API URL is not mixed between `localhost` and another host unexpectedly.
- Add the deployed frontend origin to `FRONTEND_URL` or `CORS_ORIGINS` for separate-service deployments.

FFmpeg missing:

- Install FFmpeg and FFprobe.
- Or set `FFMPEG_PATH=C:/ffmpeg/bin/ffmpeg.exe`.
- Restart the backend after changing `.env`.

Missing `SARVAM_API_KEY`:

- Use `STT_PROVIDER=auto` with `GROQ_API_KEY` or `OPENAI_API_KEY`, or add `SARVAM_API_KEY`.
- Telgish with `STT_PROVIDER=sarvam` will fail clearly without this key.

Telgish / Auto Mixed provider error:

- Configure `SARVAM_API_KEY`, `OPENAI_API_KEY`, or `GROQ_API_KEY`.
- For best Telugu-English mixed captions, prefer `STT_PROVIDER=auto` with `SARVAM_API_KEY`.

Word timings are not increasing:

- Restart the backend so it loads the latest timestamp repair logic.
- The pipeline now repairs small non-monotonic word overlaps, for example near short words like `and`.
- Repaired words are labeled in transcript JSON with a `timing_source` ending in `_repaired`.

Telgish returning Telugu script:

- Prefer `STT_PROVIDER=sarvam` with Saaras v3 transliteration mode.
- The Whisper fallback runs a Telugu Unicode romanization layer, but some loan words may need manual correction.

Render fails:

- Install Playwright Chromium:
  `.\venv\Scripts\python.exe -m playwright install chromium`
- Start the frontend before exporting MP4 because the backend captures `RENDER_PAGE_URL`.
- Confirm FFmpeg is installed.
- On Docker/Render, leave `RENDER_PAGE_URL` blank unless you have a separate frontend service; the backend will use its own `/render.html` page.
- Check `GET /api/health/export` to confirm FFmpeg, FFprobe, Playwright, Chromium launch, render-page URL, and export directory writability.

Could not determine video duration:

- The export flow now sends a resolved duration from the editor to the backend.
- Check that timeline clips, imported media duration, captions, or custom duration are present.
- For captions-only export, choose a custom duration if there is no source video.
- If full-video export still fails, verify FFprobe can read the uploaded video file.

Output file missing:

- Check the backend terminal for the export stage error. Export failures now identify `media_resolution`, `duration_detection`, `headless_launch`, `composition_load`, `render_frames`, `ffmpeg_encode`, or `output_write`.
- Verify the original upload still exists in `storage/uploads`.
- Try exporting SRT or JSON first to confirm captions exist.
