# Caption Timing

CapInsta uses canonical word timing as the only production timing authority.

## Ownership and data flow

Platform-independent caption timing lives in `rust/crates/captions`. Web and
desktop are rendering/editing shells. They consume the versioned
`capinsta.caption.v2` document through WASM and do not estimate production word
boundaries independently.

```text
edited timeline or selected range
  -> render final mixed audio
  -> normalize to mono 16 kHz signed PCM16 WAV
  -> waveform VAD
  -> provider word timestamps, or transcript text
  -> validate and repair canonical words
  -> forced alignment when timing is unreliable
  -> restore the range timeline offset
  -> construct Rust-owned pages
  -> render page visibility and active words
```

The existing asset-caption action remains an explicit
`audio_origin=source_media` compatibility path. A timeline caption action must
supply the final mixed render, including cuts, speed changes, track mutes,
transitions, gaps, leading silence and its In/Out range.

## Canonical model

Words have stable IDs, spoken and displayed text, integer microsecond ranges,
confidence, provenance and review state. Pages reference word IDs and never own
independently interpolated word timestamps.

Active words use half-open intervals:

```text
start_us <= playback_time_us < end_us
```

Milliseconds, seconds and frames are boundary formats only. SRT/VTT use
deterministic rounding; frame integrations use rational frame rates.

## Timeline origin

Normalized sample zero has an explicit origin:

- `rendered_timeline`: zero is project zero.
- `rendered_selection`: zero maps to `timeline_offset_us`.
- `source_media`: compatibility mode for an unedited source asset.

After audio-relative VAD and alignment:

```text
final_start_us = local_start_us + timeline_offset_us
final_end_us   = local_end_us   + timeline_offset_us
```

The offset is restored exactly once. Complete project duration remains separate
from selected-render duration.

## Normalization and VAD

Audio is decoded with a known timestamp origin and normalized to mono, 16,000 Hz,
signed PCM16 WAV. Stereo selects the highest-energy channel, avoiding phase
cancellation. FFmpeg handles presentation timestamps, compressed-codec delay and
AIFF/AIFF-C; Rust also decodes supported uncompressed WAV/AIFF variants.

VAD and ASR gaps are both used. Boundaries consider verified pauses, punctuation,
speaker changes, duration, character and word limits. The default pause threshold
is 360 ms and can adapt to measured cadence.

## Silence visibility

Captions are not extended until the next caption.

```text
page.end_us = min(last_word.end_us + post_word_hold_us, next_page.start_us)
```

The final page is also clamped to media duration. Default hold is 250 ms
(configurable from 150–350 ms). Speech ending at 4.000 s and resuming at 6.500 s
makes the caption disappear at 4.250 s, leaving a 2.250 s blank interval.

A page can remain visible during post-word hold while no word is active.

## Validation and forced alignment

Rust validates bounds, positive durations, order, overlaps, confidence and
provider/decoded-duration compatibility. Only small deterministic repairs are
made. Significant failures request forced alignment.

Provider-native word timestamps are preferred. WhisperX and stable-ts are the
local forced-alignment routes. Alignment runs for missing or segment-only
timestamps, significant overlap, non-monotonic timing, low confidence, drift,
token-changing edits or explicit realignment. Gemini returns transcript text
only and is not asked to generate timestamps.

Failed alignment retains clearly marked fallback data:

```text
timing_source = "estimated"
timing_needs_review = true
active_word_effects_enabled = false
```

Uniform segment interpolation is display-only.

## Text edits and translation

`spoken_text`, `display_text` and timing remain separate. Spelling correction
and one-to-one transliteration preserve IDs and timing. Spoken token count/order
changes require realignment. Translation with different tokenization uses
page-level display text or explicit alignment, never arbitrary source timings.

## Diagnostics and compatibility

Diagnostics report normalized sample count, durations, offset, provider/repaired/
aligned/estimated counts, VAD durations, drift and validation failures. Transcript
content is excluded by default; opt in with
`CAPTION_LOG_TRANSCRIPT_CONTENT=true`.

Legacy `capinsta.transcript.v1` documents convert at the boundary to the v2 Rust
document while preserving compatible IDs. Existing stored jobs are not
retroactively realigned.
