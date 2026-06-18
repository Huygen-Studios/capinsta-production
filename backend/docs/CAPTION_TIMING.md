# Caption Timing

Huygen Caps builds captions from word timestamps, not from already-rendered caption blocks. The timing path is:

1. FFmpeg extracts clean mono 16 kHz WAV audio.
2. FFmpeg `silencedetect` finds speech pauses and stores silence gaps.
3. The selected STT provider returns transcript text and, when available, word timestamps.
4. WhisperX can be enabled as an optional forced-alignment provider.
5. stable-ts and Silero VAD are optional fallback/diagnostic providers.
6. Every word is validated and marked with a timing source.
7. Code-mixed provider timelines that are visibly compressed are projected back over detected speech spans.
8. The Caption Sync Engine can refine stable-ts word timing and auto-correct global shift/skew when enabled.
9. Caption chunks are rebuilt from aligned words with pause-aware rules.
10. Preview and export use the same React renderer.

## Caption Sync Engine

The sync engine has three safe layers:

- Source of truth: `transcript.alignedWords[]`. Caption blocks are rebuilt from this ordered word list after alignment/sync. Old caption block boundaries are not trusted as production timing.
- Manual/global sync applies `new_time = anchor + ((old_time - anchor) * skew) + shift` to segments and words. It supports offset, speed/skew correction, optional ranges, clamping, and monotonic word repair.
- Auto global sync compares caption activity with FFmpeg speech activity, searches shift/skew candidates, and applies only when quality and improvement thresholds pass.
- stable-ts refinement is optional. When enabled, Huygen first tries stable-ts `align_words()` against Huygen's own spoken transcript words, then transfers only timestamps. Display text remains the provider/romanized Huygen text.

Estimated or interpolated word timing is marked `timingNeedsReview`. It is allowed so jobs can complete, but the UI warns that sync cannot be guaranteed until High Quality Alignment runs.

Default Render production stays lightweight: `ENABLE_AUTO_GLOBAL_SYNC=false`, `ENABLE_STABLE_TS=false`, `ENABLE_WHISPERX=false`, and `ENABLE_SILERO_VAD=false`. Use a worker or GPU machine for high-quality local alignment.

Sync endpoints:

```text
GET  /api/jobs/{jobId}/timing-debug
POST /api/jobs/{jobId}/sync/preview
POST /api/jobs/{jobId}/sync/apply
POST /api/jobs/{jobId}/sync/auto
```

`sync/preview` does not persist. `sync/apply` persists corrected `segments_json`, refreshes `transcript_json.alignedWords`, regenerates SRT/VTT, and stores metadata under `transcript_json.metadata.sync`.

Important: backend timing changes do not repair old jobs already stored in the browser or database. Generate a fresh caption job after deploying timing changes.

## Timing Sources

Each word carries a `timingSource`:

- `provider`: real word timing from Sarvam, OpenAI, Groq, or another STT provider.
- `whisperx`: forced-aligned word timing from WhisperX.
- `stable_ts`: stabilized Whisper timing from stable-ts when enabled.
- `vad_adjusted`: timing adjusted around detected speech pauses.
- `manual`: user-edited or nudged timing.
- `estimated`: fallback timing, usually equal distribution inside a segment or caption.

Estimated timing is allowed as a fallback, but it is marked and surfaced in the timing debug report because it is not production-grade for tight word sync.

## Pause-Aware Chunking

Defaults:

- Target words: `4`
- Max words: `5`
- Min words: `2`
- Max characters: `34`
- Min duration: `0.8s`
- Max duration: `3.0s`
- Pause split threshold: `0.30s`
- Merge gap: `0.12s`
- Phrase hold: `0.12s`

If the gap between two words is greater than the pause split threshold, Huygen Caps splits the caption and does not merge across that pause. Captions start at the first word and end at the last word plus the phrase hold. If that hold would overlap the next chunk, it is clamped.

## Timing Controls

The Caption Editor has a Timing & Sync section:

- Global offset shifts preview time and exported captions by `-1.0s` to `+1.0s`.
- Selected caption nudge shifts only the selected caption by `-0.05s`, `+0.05s`, `-0.1s`, or `+0.1s` and marks it `manual`.
- Pause split controls where chunks break around silence.
- Phrase hold controls how long captions stay after the last spoken word.
- Rebuild Timing rebuilds captions from the saved aligned transcript without re-running STT.
- Reset Timing clears offset/nudge UI state and rebuilds from the transcript.

## Debugging

Use:

```text
GET /api/jobs/{jobId}/timing-debug
GET /api/captions/jobs/{jobId}/timing-debug
GET /api/health/timing
```

The timing debug endpoint returns word counts, chunk counts, timing source counts, detected silence gaps, suspicious timing warnings, first words with timestamps, and the pause threshold used.

`/api/captions/jobs/{jobId}/timing-debug` also includes `chunkAudit` for recent jobs:

- `timestampBasis: "chunk_local"` means provider word times were treated as relative to the audio chunk and `chunk.start_time` was added once.
- `timestampBasis: "absolute"` means the provider already returned timeline-absolute times, so the chunk start was not added again.
- `rawFirstWords` / `rawLastWords` show provider chunk-local samples before conversion.
- `absoluteFirstWords` / `absoluteLastWords` show samples after timeline conversion.
- `normalizedFirstWords` / `normalizedLastWords` show samples after romanization, dedupe, retiming, and validation.
- `warnings` reports out-of-range provider words, non-monotonic times, bad overlaps with the previous chunk, dropped duplicate overlap words, and speech-span retiming.

Timing source values:

- `provider` means real provider timing or provider timing converted from chunk-local to timeline time.
- `estimated` means fallback/interpolated timing. Treat these captions as timing review required.
- `vad_adjusted`, `stable_ts`, and `whisperx` mean an optimization/alignment layer changed timing.
- `manual` means a user edited/nudged timing.

When checking a fix, generate a new job. Existing browser captions and old job IDs keep their old timestamps and will still show old gaps.

Quick sync check:

1. Upload a clear 10-second clip with speech starting after a visible silence.
2. Generate captions in the target language mode.
3. Open `/api/captions/jobs/{jobId}/timing-debug`.
4. Confirm `first20Words` starts near the first audible word and `chunkAudit` has no double-offset warnings.
5. Set Global offset to `+0.80s`, preview the first word, export MP4, and confirm the burned caption shifts by the same amount.

## Render Notes

Render should keep heavy providers optional unless the plan has enough CPU/disk:

```env
ALIGNMENT_PROVIDER=auto
ENABLE_WHISPERX=false
ENABLE_STABLE_TS=false
ENABLE_SILERO_VAD=false
PAUSE_SPLIT_THRESHOLD=0.30
DEFAULT_GLOBAL_CAPTION_OFFSET=0
ENABLE_SPEECH_SPAN_RETIMER=true
```

FFmpeg/FFprobe are required. WhisperX, stable-ts, and Silero are not installed by the production Dockerfile by default; install `requirements-optional-ai.txt` only for a worker or machine that can afford the heavier dependencies.

`ENABLE_SPEECH_SPAN_RETIMER` is lightweight and uses FFmpeg speech/silence spans. It fixes providers that return useful code-mixed text but compress word timestamps into the early part of a chunk, causing fake caption gaps during audible speech.

## Known Limitations

Hinglish, Telgish, and Auto Mixed Indian may use provider word timings when forced alignment cannot reliably map Romanized display text back to the spoken language. In that case, the app preserves the provider timing and marks any fallback words as `estimated` instead of pretending they are aligned.
