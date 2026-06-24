import logging
import os
from typing import Any

from .audio import Chunk
from .pipeline_config import CaptionPipelineConfig, resolve_pipeline_config
from .language_modes import (
    final_text_requires_romanization,
    normalize_caption_text,
    normalize_language_mode,
    normalize_word_token_with_metadata,
    text_from_words,
    validate_roman_output,
)

logger = logging.getLogger(__name__)

MIN_WORD_DURATION = 0.04
MIN_SPEECH_RETIME_WORDS = 6
MIN_SPEECH_RETIME_TRAILING_GAP = 1.0
MIN_SPEECH_RETIME_COMPRESSION_RATIO = 0.78
MIN_PHRASE_SPEECH_RETIME_WORDS = 4
CHUNK_ABSOLUTE_TIME_TOLERANCE = 0.75
CHUNK_END_TOLERANCE = 0.75
BAD_CHUNK_OVERLAP_TOLERANCE = 0.5
CHUNK_AUDIT_SAMPLE_SIZE = 5


class TranscriptValidationError(ValueError):
    pass


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _env_bool(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on", "enabled"}:
        return True
    if value in {"0", "false", "no", "off", "disabled"}:
        return False
    return default


def _sample_words(words: list[dict[str, Any]], limit: int = CHUNK_AUDIT_SAMPLE_SIZE) -> list[dict[str, Any]]:
    sample: list[dict[str, Any]] = []
    for word in words[:limit]:
        sample.append(
            {
                "word": str(word.get("word") or word.get("text") or "").strip(),
                "start": _as_float(word.get("start")),
                "end": _as_float(word.get("end")),
            }
        )
    return sample


def _chunk_duration(chunk: Chunk) -> float:
    return max(0.0, float(chunk.end_time) - float(chunk.start_time))


def _detect_provider_timestamp_basis(raw_words: list[dict[str, Any]], chunk: Chunk) -> str:
    if int(chunk.index) <= 0:
        return "chunk_local"

    starts = [_as_float(word.get("start")) for word in raw_words]
    ends = [_as_float(word.get("end")) for word in raw_words]
    starts = [value for value in starts if value is not None]
    ends = [value for value in ends if value is not None]
    if not starts or not ends:
        return "chunk_local"

    first_start = min(starts)
    last_end = max(ends)
    chunk_start = float(chunk.start_time)
    chunk_end = float(chunk.end_time)
    duration = _chunk_duration(chunk)

    looks_absolute = (
        first_start >= chunk_start - CHUNK_ABSOLUTE_TIME_TOLERANCE
        and last_end <= chunk_end + CHUNK_END_TOLERANCE
    )
    looks_chunk_local = first_start <= duration + CHUNK_END_TOLERANCE and last_end <= duration + CHUNK_END_TOLERANCE
    if looks_absolute and not looks_chunk_local:
        return "absolute"
    if looks_absolute and first_start >= chunk_start * 0.7:
        return "absolute"
    return "chunk_local"


def _provider_declared_timestamp_basis(metadata: dict[str, Any]) -> str | None:
    value = str(metadata.get("timestampBasis") or metadata.get("timestamp_basis") or "").strip().lower()
    if value in {"chunk_local", "absolute", "full_audio", "none"}:
        return value
    return None


def _is_estimated_timing_source(value: Any) -> bool:
    source = str(value or "").lower()
    return any(marker in source for marker in ("estimated", "interpolated", "synthetic", "segment_derived", "fallback"))


def _provider_time_warnings(raw_words: list[dict[str, Any]], chunk: Chunk, basis: str) -> list[str]:
    warnings: list[str] = []
    duration = _chunk_duration(chunk)
    previous_start: float | None = None
    previous_end: float | None = None
    chunk_start = float(chunk.start_time)
    chunk_end = float(chunk.end_time)

    for index, raw_word in enumerate(raw_words):
        start = _as_float(raw_word.get("start"))
        end = _as_float(raw_word.get("end"))
        text = str(raw_word.get("word") or raw_word.get("text") or "").strip()
        if start is None or end is None:
            continue
        if basis == "chunk_local":
            if start < -0.05:
                warnings.append(f"provider word {index} '{text}' starts before 0 ({start:.3f}s)")
            if end > duration + CHUNK_END_TOLERANCE:
                warnings.append(f"provider word {index} '{text}' ends after chunk duration ({end:.3f}s > {duration:.3f}s)")
        else:
            if start < chunk_start - CHUNK_ABSOLUTE_TIME_TOLERANCE:
                warnings.append(f"absolute word {index} '{text}' starts before chunk start ({start:.3f}s < {chunk_start:.3f}s)")
            if end > chunk_end + CHUNK_END_TOLERANCE:
                warnings.append(f"absolute word {index} '{text}' ends after chunk end ({end:.3f}s > {chunk_end:.3f}s)")
        if previous_start is not None and start < previous_start - 0.001:
            warnings.append(f"provider word {index} '{text}' is non-monotonic by start")
        if previous_end is not None and end < previous_end - 0.001:
            warnings.append(f"provider word {index} '{text}' is non-monotonic by end")
        previous_start = start
        previous_end = end

    return warnings[:20]


def _normalize_word(raw_word: dict[str, Any], language_mode: str) -> dict[str, Any] | None:
    raw_text = str(raw_word.get("word") or raw_word.get("text") or "").strip()
    word_meta = normalize_word_token_with_metadata(
        raw_text,
        language_mode,
    )
    word = word_meta.get("word", "")
    start = _as_float(raw_word.get("start"))
    end = _as_float(raw_word.get("end"))
    if not word or start is None or end is None:
        return None

    normalized = {
        "word": word,
        "displayedWord": word,
        "spokenWord": str(raw_word.get("spokenWord") or raw_word.get("originalWord") or raw_text or word).strip(),
        "start": round(start, 3),
        "end": round(end, 3),
        "score": _as_float(raw_word.get("score")) if raw_word.get("score") is not None else 0.0,
    }
    if word_meta.get("originalWord"):
        normalized["originalWord"] = word_meta["originalWord"]
    if word_meta.get("languageHint"):
        normalized["languageHint"] = word_meta["languageHint"]
    if raw_word.get("confidence") is not None:
        normalized["confidence"] = _as_float(raw_word.get("confidence"))
    if raw_word.get("timing_source"):
        normalized["timing_source"] = raw_word["timing_source"]
        source = str(raw_word["timing_source"]).lower()
        if any(marker in source for marker in ("interpolated", "estimated", "synthetic", "fallback")):
            normalized["timingNeedsReview"] = True
            normalized["timingReviewRequired"] = True
            normalized["timingWarning"] = "Word timing is estimated; sync cannot be guaranteed. Use High Quality Alignment."
    if raw_word.get("timingSource"):
        normalized["timingSource"] = raw_word["timingSource"]
    if raw_word.get("provider"):
        normalized["provider"] = raw_word["provider"]
    if raw_word.get("timestampBasis") or raw_word.get("timestamp_basis"):
        normalized["timestampBasis"] = raw_word.get("timestampBasis") or raw_word.get("timestamp_basis")
    if raw_word.get("chunkIndex") is not None:
        normalized["chunkIndex"] = raw_word.get("chunkIndex")
    if end <= start:
        normalized["end"] = round(start + MIN_WORD_DURATION, 3)
        _mark_timing_repaired(
            normalized,
            f"duration expanded from {start:.3f}-{end:.3f}",
        )
    return normalized


def _expand_compound_raw_word(raw_word: dict[str, Any]) -> list[dict[str, Any]]:
    raw_text = str(raw_word.get("word") or raw_word.get("text") or "").strip()
    tokens = [token for token in raw_text.split() if token]
    start = _as_float(raw_word.get("start"))
    end = _as_float(raw_word.get("end"))

    if raw_word.get("preservePhraseTiming"):
        return [raw_word]

    if len(tokens) <= 1 or start is None or end is None or end <= start:
        return [raw_word]

    duration = end - start
    source = str(raw_word.get("timing_source") or "provider_word")
    timing_source = source if "interpolated" in source else f"{source}_interpolated"
    expanded: list[dict[str, Any]] = []

    for index, token in enumerate(tokens):
        token_start = start + (duration * index / len(tokens))
        token_end = end if index == len(tokens) - 1 else start + (duration * (index + 1) / len(tokens))
        expanded.append(
            {
                **raw_word,
                "word": token,
                "start": round(token_start, 3),
                "end": round(max(token_start + MIN_WORD_DURATION, token_end), 3),
                "timing_source": timing_source,
                "timingSource": "estimated",
                "timingNeedsReview": True,
                "timingReviewRequired": True,
                "timingWarning": "Provider returned one timestamp for multiple words; word timing is estimated until forced alignment runs.",
            }
        )

    return expanded


def _mark_timing_repaired(word: dict[str, Any], reason: str) -> None:
    source = str(word.get("timing_source") or "provider_word")
    if "repaired" not in source:
        source = f"{source}_repaired"
    word["timing_source"] = source
    word["timing_repair"] = reason


def _clip_speech_segments_to_chunk(
    speech_segments: list[dict[str, Any]] | None,
    chunk_start: float,
    chunk_end: float,
) -> list[tuple[float, float]]:
    intervals: list[tuple[float, float]] = []
    for segment in speech_segments or []:
        start = _as_float(segment.get("start"))
        end = _as_float(segment.get("end"))
        if start is None or end is None:
            continue
        clipped_start = max(chunk_start, start)
        clipped_end = min(chunk_end, end)
        if clipped_end - clipped_start >= MIN_WORD_DURATION:
            intervals.append((round(clipped_start, 3), round(clipped_end, 3)))

    intervals.sort(key=lambda item: item[0])
    merged: list[tuple[float, float]] = []
    for start, end in intervals:
        if merged and start - merged[-1][1] <= 0.08:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _project_speech_offset_to_time(offset: float, intervals: list[tuple[float, float]]) -> float:
    if not intervals:
        return max(0.0, offset)

    remaining = max(0.0, offset)
    for start, end in intervals:
        duration = max(0.0, end - start)
        if remaining <= duration:
            return start + remaining
        remaining -= duration
    return intervals[-1][1]


def _retime_compressed_words_to_speech(
    words: list[dict[str, Any]],
    chunk_start: float,
    chunk_end: float,
    speech_segments: list[dict[str, Any]] | None,
) -> int:
    if not _env_bool("ENABLE_SPEECH_SPAN_RETIMER", True):
        return 0
    if len(words) < MIN_SPEECH_RETIME_WORDS:
        return 0

    intervals = _clip_speech_segments_to_chunk(speech_segments, chunk_start, chunk_end)
    if not intervals:
        return 0

    first_start = _as_float(words[0].get("start"))
    last_end = _as_float(words[-1].get("end"))
    if first_start is None or last_end is None or last_end <= first_start:
        return 0

    target_start = min(first_start, intervals[0][0])
    if target_start < intervals[0][0] - 0.2:
        intervals = [(target_start, intervals[0][0]), *intervals]
    target_end = intervals[-1][1]
    source_span = max(MIN_WORD_DURATION, last_end - first_start)
    target_speech_duration = sum(max(0.0, end - start) for start, end in intervals)
    target_span = max(MIN_WORD_DURATION, target_end - target_start)
    trailing_gap = target_end - last_end

    if trailing_gap < MIN_SPEECH_RETIME_TRAILING_GAP:
        return 0
    if source_span >= target_speech_duration * MIN_SPEECH_RETIME_COMPRESSION_RATIO:
        return 0
    if target_span <= source_span + MIN_SPEECH_RETIME_TRAILING_GAP:
        return 0

    repaired = 0
    previous_end = target_start
    for word in words:
        original_start = _as_float(word.get("start"))
        original_end = _as_float(word.get("end"))
        if original_start is None or original_end is None or original_end <= original_start:
            continue

        start_offset = ((original_start - first_start) / source_span) * target_speech_duration
        end_offset = ((original_end - first_start) / source_span) * target_speech_duration
        new_start = max(previous_end, _project_speech_offset_to_time(start_offset, intervals))
        new_end = max(new_start + MIN_WORD_DURATION, _project_speech_offset_to_time(end_offset, intervals))
        new_end = min(target_end, new_end)
        if new_end <= new_start:
            new_end = min(target_end, new_start + MIN_WORD_DURATION)

        word["start"] = round(max(0.0, new_start), 3)
        word["end"] = round(max(word["start"] + MIN_WORD_DURATION, new_end), 3)
        _mark_timing_repaired(
            word,
            f"speech span retimed from {original_start:.3f}-{original_end:.3f}",
        )
        previous_end = word["end"]
        repaired += 1

    if repaired:
        logger.info(
            "retimed compressed provider word span to speech intervals",
            extra={
                "word_count": repaired,
                "chunk_start": round(chunk_start, 3),
                "chunk_end": round(chunk_end, 3),
                "source_span": round(source_span, 3),
                "target_speech_duration": round(target_speech_duration, 3),
                "target_end": round(target_end, 3),
            },
        )
    return repaired


def _retime_estimated_phrase_words_to_speech(
    words: list[dict[str, Any]],
    chunk_start: float,
    chunk_end: float,
    speech_segments: list[dict[str, Any]] | None,
) -> int:
    """
    When a provider returns an entire chunk as one timestamped phrase, expanded
    words are estimated rather than real word timings. Place those words across
    detected speech islands instead of the raw 20-second chunk, so caption rows
    follow the speaker regions more closely.
    """
    if len(words) < MIN_PHRASE_SPEECH_RETIME_WORDS:
        return 0

    intervals = _clip_speech_segments_to_chunk(speech_segments, chunk_start, chunk_end)
    if not intervals:
        return 0

    total_speech_duration = sum(max(0.0, end - start) for start, end in intervals)
    if total_speech_duration < MIN_WORD_DURATION * len(words):
        return 0

    remaining_words = len(words)
    remaining_duration = total_speech_duration
    allocations: list[tuple[float, float, int]] = []
    for index, (interval_start, interval_end) in enumerate(intervals):
        interval_duration = max(0.0, interval_end - interval_start)
        if interval_duration <= 0:
            continue
        if index == len(intervals) - 1:
            count = remaining_words
        else:
            proportional = interval_duration / max(MIN_WORD_DURATION, remaining_duration)
            count = max(0, min(remaining_words, int(round(proportional * remaining_words))))
        if count:
            allocations.append((interval_start, interval_end, count))
            remaining_words -= count
        remaining_duration = max(0.0, remaining_duration - interval_duration)

    if remaining_words > 0:
        if allocations:
            start, end, count = allocations[-1]
            allocations[-1] = (start, end, count + remaining_words)
        else:
            start, end = intervals[-1]
            allocations.append((start, end, remaining_words))

    repaired = 0
    word_index = 0
    for interval_start, interval_end, count in allocations:
        if count <= 0:
            continue
        step = max(MIN_WORD_DURATION, (interval_end - interval_start) / count)
        previous_end = interval_start
        for local_index in range(count):
            if word_index >= len(words):
                break
            word = words[word_index]
            original_start = _as_float(word.get("start"))
            original_end = _as_float(word.get("end"))
            new_start = max(previous_end, interval_start + local_index * step)
            new_end = interval_end if local_index == count - 1 else interval_start + (local_index + 1) * step
            new_end = min(interval_end, max(new_start + MIN_WORD_DURATION, new_end))
            word["start"] = round(max(0.0, new_start), 3)
            word["end"] = round(max(word["start"] + MIN_WORD_DURATION, new_end), 3)
            _mark_timing_repaired(
                word,
                f"estimated phrase retimed to VAD speech from {original_start:.3f}-{original_end:.3f}",
            )
            previous_end = word["end"]
            repaired += 1
            word_index += 1

    if repaired:
        logger.info(
            "retimed estimated phrase words to speech intervals",
            extra={
                "word_count": repaired,
                "chunk_start": round(chunk_start, 3),
                "chunk_end": round(chunk_end, 3),
                "speech_intervals": len(intervals),
            },
        )
    return repaired


def _snap_single_long_word_to_first_speech(
    words: list[dict[str, Any]],
    chunk_start: float,
    chunk_end: float,
    speech_segments: list[dict[str, Any]] | None,
) -> int:
    if len(words) != 1:
        return 0

    word = words[0]
    start = _as_float(word.get("start"))
    end = _as_float(word.get("end"))
    if start is None or end is None or end - start < 1.2:
        return 0

    intervals = _clip_speech_segments_to_chunk(speech_segments, chunk_start, chunk_end)
    if not intervals:
        return 0

    speech_start, speech_end = intervals[0]
    original_start = start
    original_end = end
    word_duration = min(0.5, max(0.18, speech_end - speech_start))
    word["start"] = round(max(0.0, speech_start), 3)
    word["end"] = round(max(word["start"] + MIN_WORD_DURATION, word["start"] + word_duration), 3)
    _mark_timing_repaired(
        word,
        f"single long word snapped to speech from {original_start:.3f}-{original_end:.3f}",
    )
    return 1


def repair_word_timestamps(segments: list[dict[str, Any]], *, repair_across_segments: bool = True) -> int:
    """
    Keep word order intact while repairing provider/alignment overlaps.

    Real STT and forced-alignment providers occasionally return adjacent words
    with duplicated or slightly backwards boundaries. The caption renderer needs
    monotonic intervals, so repair those boundaries before validation instead of
    failing the whole generation job.
    """
    previous_end: float | None = None
    repaired_count = 0

    for seg in segments:
        if not repair_across_segments:
            previous_end = None
        words = seg.get("words") or []
        if not words:
            continue

        for word in words:
            start = _as_float(word.get("start"))
            end = _as_float(word.get("end"))
            if start is None or end is None:
                continue

            original_start = start
            original_end = end
            if previous_end is not None and start < previous_end:
                start = previous_end
                end = max(end, start + MIN_WORD_DURATION)
                repaired_count += 1
                _mark_timing_repaired(
                    word,
                    f"overlap adjusted from {original_start:.3f}-{original_end:.3f}",
                )
            elif end <= start:
                end = start + MIN_WORD_DURATION
                repaired_count += 1
                _mark_timing_repaired(
                    word,
                    f"duration expanded from {original_start:.3f}-{original_end:.3f}",
                )

            word["start"] = round(max(0.0, start), 3)
            word["end"] = round(max(word["start"] + MIN_WORD_DURATION, end), 3)
            previous_end = word["end"]

        valid_words = [
            word
            for word in words
            if _as_float(word.get("start")) is not None and _as_float(word.get("end")) is not None
        ]
        if valid_words:
            seg["start"] = valid_words[0]["start"]
            seg["end"] = valid_words[-1]["end"]

    if repaired_count:
        logger.warning("repaired non-monotonic word timings", extra={"repaired_word_count": repaired_count})
    return repaired_count


def normalize_aligned_segments(segments: list[dict[str, Any]], language_mode: str) -> list[dict[str, Any]]:
    normalized_segments: list[dict[str, Any]] = []
    mode = normalize_language_mode(language_mode)

    for seg in segments:
        words = []
        for raw_word in seg.get("words") or []:
            for expanded_raw_word in _expand_compound_raw_word(raw_word):
                normalized = _normalize_word(expanded_raw_word, language_mode)
                if normalized:
                    words.append(normalized)

        text = normalize_caption_text(seg.get("text") or text_from_words(w["word"] for w in words), mode)
        try:
            validate_roman_output(text, mode)
        except ValueError as exc:
            raise TranscriptValidationError(str(exc)) from exc
        start = _as_float(seg.get("start"))
        end = _as_float(seg.get("end"))

        if words:
            start = words[0]["start"] if start is None else min(start, words[0]["start"])
            end = words[-1]["end"] if end is None else max(end, words[-1]["end"])
            if not text:
                text = text_from_words(w["word"] for w in words)

        if start is None or end is None or end <= start or not text:
            continue

        normalized_segments.append(
            {
                "id": str(seg.get("id") or f"seg_{len(normalized_segments) + 1:04d}"),
                "start": round(start, 3),
                "end": round(end, 3),
                "text": text,
                "words": words,
            }
        )

    repair_word_timestamps(normalized_segments)
    validate_word_timestamps(normalized_segments)
    return normalized_segments


def validate_word_timestamps(segments: list[dict[str, Any]], *, allow_intersegment_overlap: bool = False) -> None:
    previous_end = -0.001
    visible_word_count = 0

    for seg_index, seg in enumerate(segments):
        if allow_intersegment_overlap:
            previous_end = -0.001
        words = seg.get("words") or []
        if not words:
            raise TranscriptValidationError(
                f"Segment {seg_index + 1} has no word-level timestamps."
            )

        for word_index, word in enumerate(words):
            visible_word_count += 1
            start = _as_float(word.get("start"))
            end = _as_float(word.get("end"))
            text = (word.get("word") or "").strip()
            if not text:
                raise TranscriptValidationError(
                    f"Segment {seg_index + 1}, word {word_index + 1} is empty."
                )
            if start is None or end is None or end <= start:
                raise TranscriptValidationError(
                    f"Word '{text}' has broken timing ({start}, {end})."
                )
            if start < previous_end:
                raise TranscriptValidationError(
                    f"Word timings are not increasing near '{text}'."
                )
            previous_end = max(previous_end, end)

    if visible_word_count == 0:
        raise TranscriptValidationError("Transcript has no visible timed words.")


def build_word_timed_transcript_from_chunks(
    chunks: list[Chunk],
    language_mode: str,
    speech_segments: list[dict[str, Any]] | None = None,
    chunk_audit: list[dict[str, Any]] | None = None,
    pipeline_config: CaptionPipelineConfig | dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    mode = normalize_language_mode(language_mode)
    resolved_config = pipeline_config if isinstance(pipeline_config, CaptionPipelineConfig) else resolve_pipeline_config(pipeline_config if isinstance(pipeline_config, dict) else None)
    emitted_until = -0.001
    recent_words: list[str] = []
    recent_emitted: list[tuple[str, float, float]] = []
    previous_chunk_absolute_end: float | None = None

    for chunk in sorted(chunks, key=lambda c: c.index):
        metadata = getattr(chunk, "asr_metadata", None) or {}
        raw_words = metadata.get("words") or []
        provider = metadata.get("provider") or "unknown"
        audit_entry: dict[str, Any] = {
            "chunkIndex": int(chunk.index),
            "chunkStart": round(float(chunk.start_time), 3),
            "chunkEnd": round(float(chunk.end_time), 3),
            "chunkDuration": round(_chunk_duration(chunk), 3),
            "provider": provider,
            "providerWordCount": len(raw_words),
            "rawFirstWords": _sample_words(raw_words),
            "rawLastWords": _sample_words(list(raw_words)[-CHUNK_AUDIT_SAMPLE_SIZE:]),
            "absoluteFirstWords": [],
            "absoluteLastWords": [],
            "timestampBasis": "chunk_local",
            "timestampBasisSource": "fallback",
            "warnings": [],
            "droppedDuplicateWords": 0,
            "speechSpanRetimedWords": 0,
        }
        if not raw_words:
            audit_entry["warnings"].append("provider returned no word-level timestamps")
            if chunk_audit is not None:
                chunk_audit.append(audit_entry)
            raise TranscriptValidationError(
                "Transcription provider did not return word-level timestamps. "
                "Configure SARVAM_API_KEY with STT_PROVIDER=sarvam or use a "
                "Whisper provider that returns word timestamps."
            )

        declared_basis = _provider_declared_timestamp_basis(metadata)
        if declared_basis == "none":
            audit_entry["timestampBasis"] = "none"
            audit_entry["timestampBasisSource"] = "provider_declared"
            audit_entry["warnings"].append("provider declared no native word timestamp basis")
            if chunk_audit is not None:
                chunk_audit.append(audit_entry)
            raise TranscriptValidationError("Provider did not return native word timestamps for this chunk.")
        timestamp_basis = declared_basis or _detect_provider_timestamp_basis(raw_words, chunk)
        audit_entry["timestampBasis"] = timestamp_basis
        audit_entry["timestampBasisSource"] = "provider_declared" if declared_basis else "heuristic_fallback"
        if not declared_basis:
            audit_entry["warnings"].append("provider did not declare timestamp basis; heuristic fallback used")
        audit_entry["warnings"].extend(_provider_time_warnings(raw_words, chunk, timestamp_basis))

        absolute_words: list[dict[str, Any]] = []
        for raw in raw_words:
            start = _as_float(raw.get("start"))
            end = _as_float(raw.get("end"))
            if start is None or end is None:
                continue

            if timestamp_basis in {"absolute", "full_audio"}:
                absolute_start = start
                absolute_end = end
                timing_source = "provider_word_absolute"
            else:
                absolute_start = float(chunk.start_time) + start
                absolute_end = float(chunk.start_time) + end
                timing_source = "provider_word_chunk_local"

            absolute_word = {
                **raw,
                "start": absolute_start,
                "end": absolute_end,
                "provider": provider,
                "timing_source": raw.get("timing_source") or timing_source,
                "timingSource": raw.get("timingSource") or raw.get("timing_source") or timing_source,
                "chunkIndex": int(chunk.index),
                "chunkStart": round(float(chunk.start_time), 3),
                "timestampBasis": timestamp_basis,
            }
            absolute_words.extend(_expand_compound_raw_word(absolute_word))

        audit_entry["absoluteFirstWords"] = _sample_words(absolute_words)
        audit_entry["absoluteLastWords"] = _sample_words(absolute_words[-CHUNK_AUDIT_SAMPLE_SIZE:])
        if previous_chunk_absolute_end is not None and absolute_words:
            first_absolute_start = _as_float(absolute_words[0].get("start"))
            if first_absolute_start is not None and first_absolute_start < previous_chunk_absolute_end - BAD_CHUNK_OVERLAP_TOLERANCE:
                audit_entry["warnings"].append(
                    f"absolute words overlap previous chunk badly ({first_absolute_start:.3f}s < {previous_chunk_absolute_end:.3f}s)"
                )
        if absolute_words:
            last_absolute_end = _as_float(absolute_words[-1].get("end"))
            if last_absolute_end is not None:
                previous_chunk_absolute_end = max(previous_chunk_absolute_end or -0.001, last_absolute_end)

        normalized_words = [
            w for w in (_normalize_word(w, mode) for w in absolute_words) if w
        ]
        estimated_count = sum(
            1
            for word in normalized_words
            if _is_estimated_timing_source(word.get("timing_source") or word.get("timingSource"))
        )
        if estimated_count:
            estimated_ratio = estimated_count / max(1, len(normalized_words))
            audit_entry["estimatedWordCount"] = estimated_count
            audit_entry["estimatedWordRatio"] = round(estimated_ratio, 4)
            if resolved_config.timingSourcePolicy != "estimated_debug_only" and not resolved_config.quality.allowEstimatedWords:
                audit_entry["warnings"].append(f"estimated timing rejected by policy ({estimated_count} word(s))")
                if chunk_audit is not None:
                    chunk_audit.append(audit_entry)
                raise TranscriptValidationError(
                    "Provider returned estimated word timing; configured timing policy requires native or real forced alignment."
                )
            if (
                resolved_config.timingSourcePolicy != "estimated_debug_only"
                and estimated_ratio > resolved_config.quality.maximumEstimatedWordRatio
            ):
                audit_entry["warnings"].append(
                    f"estimated timing ratio {estimated_ratio:.3f} exceeds configured maximum"
                )
                if chunk_audit is not None:
                    chunk_audit.append(audit_entry)
                raise TranscriptValidationError("Estimated word timing ratio exceeds configured maximum.")
        if not normalized_words:
            audit_entry["warnings"].append("no usable word timestamps after normalization")
            if chunk_audit is not None:
                chunk_audit.append(audit_entry)
            raise TranscriptValidationError(
                f"Chunk {chunk.index + 1} has no usable word timestamps after normalization."
            )

        deduped_words: list[dict[str, Any]] = []
        dropped_duplicate_words = 0
        # Sarvam can return a whole 20-second chunk as one timestamped phrase.
        # After token expansion every word is estimated, so individual-word
        # overlap dedupe can delete legitimate repeated/common words and create
        # visible caption gaps. Keep those words; the final temporal sweep will
        # handle any real overlaps.
        allow_overlap_dedupe = not (len(raw_words) == 1 and len(normalized_words) > 1)
        for word in normalized_words:
            text = str(word.get("word") or "").lower()
            start = _as_float(word.get("start")) or 0.0
            end = _as_float(word.get("end")) or 0.0
            # Drop only words that are clearly duplicates of an already-emitted
            # word inside the chunk overlap region.  A word is considered a
            # duplicate when:
            #   1. it ends BEFORE the last emitted word (no +slack tolerance —
            #      the previous 0.02s slop was dropping legitimate last words
            #      that just happened to end within 20ms of a previous one),
            #   2. AND its text matches a recent emitted word.
            # Anything else is kept, even if the gap is tiny.
            nearby_duplicate = any(
                prev_text == text
                and min(abs(start - prev_start), abs(end - prev_end)) <= 0.9
                for prev_text, prev_start, prev_end in recent_emitted[-40:]
            )
            if allow_overlap_dedupe and end < emitted_until and nearby_duplicate:
                dropped_duplicate_words += 1
                continue
            deduped_words.append(word)
            emitted_until = max(emitted_until, end)
            recent_words.append(text)
            recent_emitted.append((text, start, end))

        normalized_words = deduped_words
        audit_entry["droppedDuplicateWords"] = dropped_duplicate_words
        if dropped_duplicate_words:
            audit_entry["warnings"].append(f"dropped {dropped_duplicate_words} duplicate overlap word(s)")
        if not normalized_words:
            audit_entry["warnings"].append("all words dropped after duplicate cleanup")
            if chunk_audit is not None:
                chunk_audit.append(audit_entry)
            continue

        single_phrase_chunk = len(raw_words) == 1 and len(normalized_words) > 1
        phrase_retimed = 0
        if single_phrase_chunk:
            phrase_retimed = _retime_estimated_phrase_words_to_speech(
                normalized_words,
                float(chunk.start_time),
                float(chunk.end_time),
                speech_segments,
            )
        single_word_snaps = _snap_single_long_word_to_first_speech(
            normalized_words,
            float(chunk.start_time),
            float(chunk.end_time),
            speech_segments,
        )
        audit_entry["speechSpanRetimedWords"] = phrase_retimed or _retime_compressed_words_to_speech(
            normalized_words,
            float(chunk.start_time),
            float(chunk.end_time),
            speech_segments,
        )
        if single_word_snaps:
            audit_entry["speechSpanRetimedWords"] += single_word_snaps
            audit_entry["warnings"].append(f"single long word snapped to speech ({single_word_snaps})")
        if phrase_retimed:
            audit_entry["warnings"].append(f"estimated phrase retimed to VAD speech ({phrase_retimed})")
        audit_entry["normalizedFirstWords"] = _sample_words(normalized_words)
        audit_entry["normalizedLastWords"] = _sample_words(normalized_words[-CHUNK_AUDIT_SAMPLE_SIZE:])
        if audit_entry["speechSpanRetimedWords"]:
            audit_entry["warnings"].append(f"speech-span retimed {audit_entry['speechSpanRetimedWords']} word(s)")

        segment_text = normalize_caption_text(
            chunk.final_text or text_from_words(w["word"] for w in normalized_words),
            mode,
        )
        if not segment_text:
            segment_text = text_from_words(w["word"] for w in normalized_words)
        try:
            validate_roman_output(segment_text, mode)
        except ValueError as exc:
            audit_entry["warnings"].append(str(exc))
            if chunk_audit is not None:
                chunk_audit.append(audit_entry)
            raise TranscriptValidationError(str(exc)) from exc

        segments.append(
            {
                "id": f"seg_{len(segments) + 1:04d}",
                "start": normalized_words[0]["start"],
                "end": normalized_words[-1]["end"],
                "text": segment_text,
                "words": normalized_words,
            }
        )
        if chunk_audit is not None:
            audit_entry["warnings"] = audit_entry["warnings"][:24]
            chunk_audit.append(audit_entry)

    # Code-mixed chunk transcription often has intentional overlap between
    # adjacent audio chunks. Do not push the later chunk to the previous
    # chunk's estimated end here; the global TranscriptAligner pass handles
    # final monotonic boundaries after cadence/speech-span repair.
    repair_word_timestamps(segments, repair_across_segments=False)
    validate_word_timestamps(segments, allow_intersegment_overlap=True)
    logger.info("word timestamps normalized", extra={"segment_count": len(segments)})
    return segments


def build_normalized_transcript(
    segments: list[dict[str, Any]],
    language_mode: str,
    provider: str,
) -> dict[str, Any]:
    mode = normalize_language_mode(language_mode)
    romanized = final_text_requires_romanization(mode) and any(
        word.get("originalWord")
        for segment in segments
        for word in segment.get("words", [])
    )
    return {
        "languageMode": mode,
        "provider": provider,
        "romanized": romanized,
        "segments": segments,
    }
