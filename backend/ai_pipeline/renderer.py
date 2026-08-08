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
    "max_words": 3,
    "min_words": 2,
    "max_chars": 28,
    "min_duration": 0.8,
    "max_duration": 2.0,
    "pause_split_threshold": 0.36,
    "merge_gap": 0.12,
    "phrase_hold": 0.25,
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
    return str(word.get("displayedWord") or word.get("displayedText") or word.get("word") or word.get("text") or "").strip()


class CaptionCueValidationError(ValueError):
    def __init__(self, code: str, message: str, report: dict[str, Any]) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.report = report


def _hard_boundary_between(left: dict[str, Any], right: dict[str, Any]) -> bool:
    for key in ("alignmentGroupId", "speakerId", "turnId"):
        left_value = left.get(key)
        right_value = right.get(key)
        if left_value is not None and right_value is not None and left_value != right_value:
            return True
    if bool(left.get("hardBoundaryAfter")) or bool(right.get("hardBoundaryBefore")):
        return True
    return False


def _flatten_words(segments: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pull every word out of every segment while preserving provenance."""
    words: list[dict[str, Any]] = []
    sequence_index = 0
    for seg in segments or []:
        if not isinstance(seg, dict):
            continue
        segment_group_id = seg.get("alignmentGroupId")
        segment_source_index = seg.get("sourceSegmentIndex")
        for local_word_index, w in enumerate(seg.get("words") or []):
            if not isinstance(w, dict):
                continue
            start = w.get("start")
            end = w.get("end")
            text = _word_text(w)
            if not text or start is None or end is None:
                continue
            word = dict(w)
            group_id = word.get("alignmentGroupId") or segment_group_id
            source_segment_index = word.get("sourceSegmentIndex", segment_source_index)
            source_word_index = word.get("sourceWordIndex", word.get("originalTokenIndex", local_word_index))
            word["word"] = text
            word["displayedWord"] = text
            word["start"] = _round_time(start)
            word["end"] = _round_time(end)
            if group_id is not None:
                word["alignmentGroupId"] = group_id
            if source_segment_index is not None:
                word["sourceSegmentIndex"] = source_segment_index
            word["sourceWordIndex"] = source_word_index
            word["originalTokenIndex"] = word.get("originalTokenIndex", source_word_index)
            word["providerTokenId"] = word.get(
                "providerTokenId",
                f"{group_id if group_id is not None else 'ungrouped'}:{source_segment_index if source_segment_index is not None else 'segment'}:{source_word_index}",
            )
            word["finalTokenSequenceIndex"] = sequence_index
            sequence_index += 1
            words.append(word)
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
    """Return renderer words without changing validated timing.

    Historical renderer code attempted to repair provider timing by dropping
    leading words and globally snapping every caption to an FFmpeg-derived
    speech onset. That is unsafe after the production timing pipeline has
    already validated Silero/VAD groups, stable-ts transfer, cue boundaries,
    and final quality gates. Export must consume the validated word timeline
    as-is; timing repair belongs upstream where provenance and group windows
    are available.
    """
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
      * word-count targets are soft layout preferences; one-word captions are
        valid and hard timing boundaries always win
      * caption end = last word's end + ``phrase_hold``, clamped before
        the next caption's start
    """
    if not words:
        return []
    cfg = {**DEFAULT_CAPTION_RULES, **(rules or {})}
    max_chars = cfg["max_chars"]
    max_words = cfg["max_words"]
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

    # Pass 1: Build initial partitions (splitting at punctuation, char limits, word limits, pauses)
    for w in words:
        text = _word_text(w)
        if not text:
            continue
        start = w.get("start")
        end = w.get("end")
        if start is None or end is None:
            continue

        if current:
            gap = _round_time(start - current[-1]["end"])
            prospective_text = " ".join(_word_text(c) for c in current + [w])
            prospective_words = len(current) + 1
            prospective_dur = (end or 0.0) - current[0]["start"]

            pause_break = gap >= cfg["pause_split_threshold"]
            merge_gap_break = gap > cfg.get("merge_gap", DEFAULT_CAPTION_RULES["merge_gap"])
            hard_boundary_break = _hard_boundary_between(current[-1], w)
            last_word_text = _word_text(current[-1]).strip()
            punctuation_break = bool(last_word_text and last_word_text[-1] in ".,!?;:")
            overflow_break = len(prospective_text) > max_chars
            too_long = prospective_dur > cfg["max_duration"]
            too_many_words = prospective_words > max_words

            if hard_boundary_break or pause_break or merge_gap_break or punctuation_break or overflow_break or too_long or too_many_words:
                flush()
        current.append(w)
    flush()

    # Pass 2: Greedy merge adjacent captions only when this preserves hard
    # timing boundaries and layout limits.
    def _can_merge(left: dict[str, Any], right: dict[str, Any]) -> bool:
        gap = _round_time(right["start"] - left["words"][-1]["end"])
        if _hard_boundary_between(left["words"][-1], right["words"][0]):
            return False
        if gap >= cfg["pause_split_threshold"]:
            return False
        if gap > cfg.get("merge_gap", DEFAULT_CAPTION_RULES["merge_gap"]):
            return False

        combined_words = len(left["words"]) + len(right["words"])
        if combined_words > cfg["max_words"]:
            return False

        combined_text = (left["text"] + " " + right["text"]).strip()
        if len(combined_text) > cfg["max_chars"]:
            return False

        combined_dur = right["words"][-1]["end"] - left["words"][0]["start"]
        if combined_dur > cfg["max_duration"]:
            return False

        return True

    if captions:
        merged_captions = [captions[0]]
        for right in captions[1:]:
            left = merged_captions[-1]
            if _can_merge(left, right):
                left["end"] = right["end"]
                left["text"] = (left["text"] + " " + right["text"]).strip()
                left["words"].extend(right["words"])
            else:
                merged_captions.append(right)
        captions = merged_captions

    # A minimum word count is a soft layout preference only. One-word captions
    # are valid, so never borrow from a following cue merely to satisfy min_words.

    # Clamp phrase-hold so each caption finishes no later than the next one
    # starts. Do not manufacture a zero-duration cue when the underlying word
    # timing already conflicts with the next cue; leave that as an overlap for
    # validation to report with the real cause.
    for i in range(len(captions) - 1):
        max_end = captions[i + 1]["start"]
        if captions[i]["end"] > max_end:
            if max_end > captions[i]["start"]:
                captions[i]["end"] = _round_time(max_end)

    return captions


def _token_identity(word: dict[str, Any]) -> str | None:
    if word.get("providerTokenId") is not None:
        return str(word.get("providerTokenId"))
    has_source_identity = any(
        word.get(key) is not None
        for key in ("alignmentGroupId", "sourceSegmentIndex", "sourceWordIndex", "originalTokenIndex", "finalTokenSequenceIndex")
    )
    if not has_source_identity:
        return None
    return str(
        f"{word.get('alignmentGroupId', 'ungrouped')}:{word.get('sourceSegmentIndex', 'segment')}:{word.get('sourceWordIndex', word.get('originalTokenIndex', word.get('finalTokenSequenceIndex', 'unknown')))}"
    )


def validate_caption_cues(captions: list[dict[str, Any]], *, stage: str) -> dict[str, Any]:
    invalid_ranges = 0
    overlaps = 0
    boundary_crossings = 0
    duplicate_tokens = 0
    non_contiguous_tokens = 0
    seen_tokens: set[str] = set()
    previous_end: float | None = None
    previous_sequence_index: int | None = None
    samples: list[dict[str, Any]] = []

    for cue_index, caption in enumerate(captions):
        start = _round_time(caption.get("start"))
        end = _round_time(caption.get("end"))
        if end <= start:
            invalid_ranges += 1
            samples.append({"cueIndex": cue_index, "reason": "invalid_range", "start": start, "end": end, "text": caption.get("text")})
        if previous_end is not None and start < previous_end:
            overlaps += 1
            samples.append({"cueIndex": cue_index, "reason": "cue_overlap", "start": start, "previousEnd": previous_end, "text": caption.get("text")})
        previous_end = max(previous_end or 0.0, end)

        words = [word for word in caption.get("words") or [] if isinstance(word, dict)]
        for left, right in zip(words, words[1:]):
            if _hard_boundary_between(left, right):
                boundary_crossings += 1
                samples.append({"cueIndex": cue_index, "reason": "hard_boundary_crossing", "left": _word_text(left), "right": _word_text(right)})
                break
        group_ids = {str(word.get("alignmentGroupId")) for word in words if word.get("alignmentGroupId") is not None}
        if len(group_ids) > 1:
            boundary_crossings += 1
            samples.append({"cueIndex": cue_index, "reason": "multi_group_caption", "groups": sorted(group_ids), "text": caption.get("text")})

        for word in words:
            token = _token_identity(word)
            if token is not None:
                if token in seen_tokens:
                    duplicate_tokens += 1
                    samples.append({"cueIndex": cue_index, "reason": "duplicate_token", "token": token, "word": _word_text(word)})
                seen_tokens.add(token)
            sequence_index = word.get("finalTokenSequenceIndex")
            if isinstance(sequence_index, int):
                if previous_sequence_index is not None and sequence_index != previous_sequence_index + 1:
                    non_contiguous_tokens += 1
                    samples.append({"cueIndex": cue_index, "reason": "non_contiguous_token_order", "previous": previous_sequence_index, "current": sequence_index})
                previous_sequence_index = sequence_index

    report = {
        "stage": stage,
        "cueCount": len(captions),
        "invalidRangeCount": invalid_ranges,
        "overlapCount": overlaps,
        "boundaryCrossingCount": boundary_crossings,
        "duplicateTokenCount": duplicate_tokens,
        "nonContiguousTokenCount": non_contiguous_tokens,
        "samples": samples[:20],
    }
    fatal_failures = invalid_ranges or overlaps or boundary_crossings or duplicate_tokens
    if fatal_failures:
        logger.error("caption_cue_validation_failed report=%s", report)
        if overlaps:
            code = "caption_cue_overlap"
            message = f"{overlaps} caption cue overlap(s) remain before export."
        elif invalid_ranges:
            code = "caption_cue_invalid_range"
            message = f"{invalid_ranges} caption cue(s) have invalid timestamp ranges."
        elif boundary_crossings:
            code = "caption_cue_crosses_hard_boundary"
            message = f"{boundary_crossings} caption cue(s) cross a hard timing boundary."
        else:
            code = "caption_token_duplicate"
            message = f"{duplicate_tokens} caption token occurrence(s) are duplicated."
        raise CaptionCueValidationError(code, message, report)
    if non_contiguous_tokens:
        logger.warning("caption_cue_validation_non_contiguous_tokens report=%s", report)
    return report


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
        raise CaptionCueValidationError(
            "caption_word_timing_missing",
            "Word-level caption timing is required for export.",
            {
                "stage": "srt_generation",
                "cueCount": 0,
                "invalidRangeCount": 0,
                "overlapCount": 0,
                "boundaryCrossingCount": 0,
                "duplicateTokenCount": 0,
                "nonContiguousTokenCount": 0,
                "samples": [{"reason": "word_level_timing_missing"}],
            },
        )

    words = _clean_words(words, audio_path)
    captions = chunk_words_into_captions(words, chunking_rules)
    validate_caption_cues(captions, stage="srt_generation")
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
        raise CaptionCueValidationError(
            "caption_word_timing_missing",
            "Word-level caption timing is required for export.",
            {
                "stage": "vtt_generation",
                "cueCount": 0,
                "invalidRangeCount": 0,
                "overlapCount": 0,
                "boundaryCrossingCount": 0,
                "duplicateTokenCount": 0,
                "nonContiguousTokenCount": 0,
                "samples": [{"reason": "word_level_timing_missing"}],
            },
        )

    words = _clean_words(words, audio_path)
    captions = chunk_words_into_captions(words, chunking_rules)
    validate_caption_cues(captions, stage="vtt_generation")
    return _build_vtt_lines(captions)
