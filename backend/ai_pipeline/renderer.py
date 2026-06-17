"""Subtitle rendering for Huygen Caps.

The renderer exports SRT/VTT subtitles from the normalized transcript
segments produced by the AI pipeline.  It is also the last line of
defence for caption timing: it runs silence detection on the source
audio, drops words the provider hallucinated inside pre-speech silence,
snaps the first caption to the actual speech onset, and groups the
remaining word timestamps into short, pause-aware caption chunks.

The chunking rules mirror the documented behavior in
``docs/CAPTION_TIMING.md`` and the frontend's
``DEFAULT_CAPTION_CHUNKING_CONFIG`` so the exported SRT/VTT matches
what the editor shows.
"""

import logging
import os
from datetime import timedelta
from typing import Any, Iterable

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pause-aware caption chunking rules
# ---------------------------------------------------------------------------
# These defaults mirror the documented behavior in docs/CAPTION_TIMING.md
# and the frontend's DEFAULT_CAPTION_CHUNKING_CONFIG.  When generate_srt
# runs in word-level mode (the default), it groups consecutive provider
# word timestamps into short, readable caption chunks so the exported
# SRT/VTT matches what a user sees in the editor and the reference.
DEFAULT_CAPTION_RULES: dict[str, Any] = {
    "target_words": 4,
    "max_words": 5,
    "min_words": 2,
    "max_chars": 36,
    "min_duration": 0.8,
    "max_duration": 3.0,
    "pause_split_threshold": 0.45,
    "merge_gap": 0.12,
    "phrase_hold": 0.12,
}

# Hallucination filter tolerance: words ending more than this many seconds
# before the detected first-speech onset are treated as provider mistakes
# and dropped.  Set wide enough to keep legitimate words that overlap the
# leading silence but tight enough to drop the typical IVR/ringback noise.
PRE_SPEECH_HALLUCINATION_GRACE = 0.35

# Snap tolerance: shift the whole word sequence forward to the detected
# onset only when the gap is wider than this, to avoid jitter on near-miss
# alignments.
FIRST_SPEECH_SNAP_SLACK = 0.5


def _round_time(value: Any) -> float:
    try:
        return round(max(0.0, float(value or 0.0)), 3)
    except (TypeError, ValueError):
        return 0.0


def _word_text(word: dict[str, Any]) -> str:
    return str(word.get("word") or word.get("text") or "").strip()


def _flatten_words(segments: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pull every word out of every segment, in segment order."""
    words: list[dict[str, Any]] = []
    for seg in segments or []:
        if not isinstance(seg, dict):
            continue
        for w in seg.get("words") or []:
            if not isinstance(w, dict):
                continue
            start = w.get("start")
            end = w.get("end")
            text = _word_text(w)
            if not text or start is None or end is None:
                continue
            words.append(
                {
                    "word": text,
                    "start": _round_time(start),
                    "end": _round_time(end),
                }
            )
    return words


def _first_speech_onset(audio_path: str | None) -> float | None:
    """Return the absolute time of the first detected speech in ``audio_path``.

    Uses FFmpeg ``silencedetect`` to find silence regions, then returns the
    start of the first non-silent region.  Returns ``None`` when the audio
    path is missing, the ffmpeg binary is unavailable, or no speech is
    detected.
    """
    if not audio_path or not os.path.exists(audio_path):
        return None
    try:
        from .timing import detect_silence_gaps

        report = detect_silence_gaps(audio_path, min_silence=0.05, threshold_db="-35dB")
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("first_speech_onset: silence detection failed: %s", exc)
        return None
    speech = report.get("speechSegments") or []
    if not speech:
        return None
    return max(0.0, float(speech[0].get("start") or 0.0))


def _drop_pre_speech_hallucinations(
    words: list[dict[str, Any]],
    first_speech_onset: float | None,
    grace: float = PRE_SPEECH_HALLUCINATION_GRACE,
) -> list[dict[str, Any]]:
    """Drop words that clearly fall inside pre-speech silence.

    STT providers sometimes hallucinate text during the leading silence of
    a chunk (ringback tones, IVR beeps, ambient noise).  When the audio
    clearly contains silence before the first speech onset, drop any word
    whose end is more than ``grace`` seconds before the onset — these are
    almost certainly misaligned and would put captions in the wrong place.
    """
    if first_speech_onset is None or first_speech_onset <= grace or not words:
        return words
    cutoff = first_speech_onset - grace
    kept = [w for w in words if (w.get("end") or 0.0) >= cutoff]
    if not kept:
        # Safety: if we would drop everything, keep the original list so
        # we never emit an empty SRT for a non-empty transcript.
        return words
    dropped = len(words) - len(kept)
    if dropped:
        logger.info(
            "renderer: dropped %s pre-speech hallucination word(s) (onset=%.3fs, cutoff=%.3fs)",
            dropped,
            first_speech_onset,
            cutoff,
        )
    return kept


def _snap_to_first_speech(
    words: list[dict[str, Any]],
    first_speech_onset: float | None,
    slack: float = FIRST_SPEECH_SNAP_SLACK,
) -> list[dict[str, Any]]:
    """If the first word starts well before the detected speech onset,
    shift the whole sequence forward so captions begin at the actual
    speech moment.
    """
    if first_speech_onset is None or not words:
        return words
    first_start = words[0].get("start") or 0.0
    gap = first_speech_onset - first_start
    if gap > slack:
        shift = gap
        for w in words:
            w["start"] = _round_time((w.get("start") or 0.0) + shift)
            w["end"] = _round_time((w.get("end") or 0.0) + shift)
        logger.info(
            "renderer: snapped first word forward by %.3fs to match speech onset %.3fs",
            shift,
            first_speech_onset,
        )
    return words


def _clean_words(
    words: list[dict[str, Any]], audio_path: str | None = None
) -> list[dict[str, Any]]:
    """Apply the standard pre-render cleaning: drop pre-speech
    hallucinations and snap the first word to the detected speech
    onset when ``audio_path`` is available.
    """
    if not words or audio_path is None:
        return words
    onset = _first_speech_onset(audio_path)
    if onset is None:
        return words
    words = _drop_pre_speech_hallucinations(words, onset)
    words = _snap_to_first_speech(words, onset)
    return words


def chunk_words_into_captions(
    words: list[dict[str, Any]], rules: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Group word-level timestamps into short, pause-aware caption chunks.

    Mirrors the rules described in ``docs/CAPTION_TIMING.md`` and the
    frontend's ``DEFAULT_CAPTION_CHUNKING_CONFIG``:

      * split on a pause longer than ``pause_split_threshold``
      * split when the candidate chunk exceeds ``max_words``, ``max_chars``,
        or ``max_duration``
      * prefer chunks of ``target_words`` (4) but never go below
        ``min_words`` (2) unless the next word is on a new pause
      * caption end = last word's end + ``phrase_hold``, clamped before
        the next caption's start
    """
    if not words:
        return []
    cfg = {**DEFAULT_CAPTION_RULES, **(rules or {})}
    captions: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []

    def flush() -> None:
        if not current:
            return
        text = " ".join(_word_text(w) for w in current).strip()
        if not text:
            current.clear()
            return
        start = current[0]["start"]
        end = (current[-1]["end"] or start) + cfg["phrase_hold"]
        captions.append(
            {
                "start": _round_time(start),
                "end": _round_time(end),
                "text": text,
                "words": list(current),
            }
        )
        current.clear()

    for w in words:
        text = _word_text(w)
        if not text:
            continue
        start = w.get("start")
        end = w.get("end")
        if start is None or end is None:
            continue

        if current:
            gap = start - current[-1]["end"]
            prospective_text = " ".join(_word_text(c) for c in current + [w])
            prospective_words = len(current) + 1
            prospective_dur = (end or 0.0) - current[0]["start"]
            pause_break = gap >= cfg["pause_split_threshold"]
            too_many_words = prospective_words > cfg["max_words"]
            too_many_chars = len(prospective_text) > cfg["max_chars"]
            too_long = prospective_dur > cfg["max_duration"]
            min_ok = len(current) >= cfg["min_words"]
            if pause_break or (min_ok and (too_many_words or too_many_chars or too_long)):
                flush()
        current.append(w)
    flush()

    # Merge trailing too-short caption into the previous one so we never
    # leave a single-word tail hanging at the end of the file.
    while len(captions) >= 2 and len(captions[-1]["words"]) < cfg["min_words"]:
        last = captions.pop()
        prev = captions[-1]
        gap = last["start"] - prev["end"]
        if gap >= cfg["pause_split_threshold"]:
            captions.append(last)
            break
        prev["end"] = last["end"]
        prev["text"] = (prev["text"] + " " + last["text"]).strip()
        prev["words"].extend(last["words"])

    # Clamp ends so each caption finishes just before the next one starts.
    for i in range(len(captions) - 1):
        max_end = captions[i + 1]["start"] - 0.01
        if captions[i]["end"] > max_end:
            captions[i]["end"] = _round_time(max_end)

    return captions


def _interpolate_missing_timestamps(
    words: list[dict[str, Any]], seg_start: float, seg_end: float
) -> list[dict[str, Any]]:
    """Ensure every word has start/end timestamps.

    This is the LAST LINE OF DEFENCE against silent word drops when the
    renderer is called with raw segment data that has missing word
    timestamps.
    """
    if not words:
        return words

    result: list[dict[str, Any]] = []
    for i, w in enumerate(words):
        w = dict(w)  # shallow copy
        if (
            "start" not in w
            or "end" not in w
            or w.get("start") is None
            or w.get("end") is None
        ):
            prev_end = seg_start
            for j in range(i - 1, -1, -1):
                if "end" in result[j] and result[j]["end"] is not None:
                    prev_end = result[j]["end"]
                    break

            next_start = seg_end
            for j in range(i + 1, len(words)):
                if "start" in words[j] and words[j]["start"] is not None:
                    next_start = words[j]["start"]
                    break

            gap_count = 1
            for j in range(i + 1, len(words)):
                if "start" not in words[j] or words[j].get("start") is None:
                    gap_count += 1
                else:
                    break

            gap_dur = (next_start - prev_end) / max(gap_count, 1)
            offset = 0
            for j in range(i, -1, -1):
                if j < len(result) and (
                    "start" not in result[j] or result[j].get("_interpolated")
                ):
                    offset += 1
                else:
                    break

            w["start"] = round(prev_end + offset * gap_dur, 3)
            w["end"] = round(w["start"] + gap_dur, 3)
            w["_interpolated"] = True
            logger.debug(
                "Interpolated timestamp for word '%s': %s-%s",
                w.get("word", ""),
                w["start"],
                w["end"],
            )
        result.append(w)
    return result


def format_timestamp(seconds: float, use_comma: bool = True) -> str:
    """Format seconds into SRT/VTT timestamp.

    SRT uses comma as the millisecond separator (``00:00:00,000``);
    WebVTT uses a dot (``00:00:00.000``).
    """
    seconds = max(0.0, float(seconds or 0.0))
    td = timedelta(seconds=seconds)
    hours, remainder = divmod(td.seconds, 3600)
    minutes, seconds_int = divmod(remainder, 60)
    milliseconds = int(td.microseconds / 1000)
    separator = "," if use_comma else "."
    return f"{hours:02d}:{minutes:02d}:{seconds_int:02d}{separator}{milliseconds:03d}"


def _build_srt_lines(captions: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for i, cap in enumerate(captions, start=1):
        lines.append(str(i))
        lines.append(
            f"{format_timestamp(cap['start'])} --> {format_timestamp(cap['end'])}"
        )
        lines.append(cap["text"])
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _build_vtt_lines(captions: list[dict[str, Any]]) -> str:
    lines = ["WEBVTT", ""]
    for cap in captions:
        lines.append(
            f"{format_timestamp(cap['start'], use_comma=False)} --> "
            f"{format_timestamp(cap['end'], use_comma=False)}"
        )
        lines.append(cap["text"])
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _render_segment_level(segments: Iterable[dict[str, Any]], use_comma: bool) -> str:
    """Legacy segment-level export (used when no word-level data is available)."""
    lines: list[str] = ["WEBVTT", ""] if not use_comma else []
    idx = 1
    for seg in segments or []:
        if not isinstance(seg, dict):
            continue
        start = seg.get("start", 0)
        end = seg.get("end", start + 1)
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        if use_comma:
            lines.append(str(idx))
            lines.append(f"{format_timestamp(start)} --> {format_timestamp(end)}")
            lines.append(text)
            lines.append("")
        else:
            lines.append(
                f"{format_timestamp(start, use_comma=False)} --> "
                f"{format_timestamp(end, use_comma=False)}"
            )
            lines.append(text)
            lines.append("")
        idx += 1
    return "\n".join(lines).rstrip() + "\n"


def generate_srt(
    segments: list[dict[str, Any]],
    word_level: bool = True,
    audio_path: str | None = None,
    chunking_rules: dict[str, Any] | None = None,
) -> str:
    """Generate SRT subtitles with tight, pause-aware caption chunks.

    In word-level mode (the default) the renderer flattens every word
    timestamp across all segments, drops words the provider hallucinated
    inside pre-speech silence, snaps the first caption to the detected
    speech onset, and groups the remaining words into short caption
    chunks.  Pass ``audio_path`` to enable silence detection; without it
    the renderer falls back to the raw provider timestamps.

    Set ``word_level=False`` to render one SRT entry per segment
    (legacy fallback for transcripts without word-level data).
    """
    if not word_level:
        return _render_segment_level(segments, use_comma=True)

    words = _flatten_words(segments)
    if not words:
        return _render_segment_level(segments, use_comma=True)

    words = _clean_words(words, audio_path)
    captions = chunk_words_into_captions(words, chunking_rules)
    return _build_srt_lines(captions)


def generate_vtt(
    segments: list[dict[str, Any]],
    word_level: bool = True,
    audio_path: str | None = None,
    chunking_rules: dict[str, Any] | None = None,
) -> str:
    """Generate WebVTT subtitles with tight, pause-aware caption chunks.

    See :func:`generate_srt` for parameter details.
    """
    if not word_level:
        return _render_segment_level(segments, use_comma=False)

    words = _flatten_words(segments)
    if not words:
        return _render_segment_level(segments, use_comma=False)

    words = _clean_words(words, audio_path)
    captions = chunk_words_into_captions(words, chunking_rules)
    return _build_vtt_lines(captions)
