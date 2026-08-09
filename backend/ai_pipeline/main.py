import logging
import os
import asyncio
from typing import Any, Dict

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

from .alignment_validator import check_hallucination, validate_alignment
from .aligner import TranscriptAligner, align_text
from .audio import apply_fade, extract_audio, overlap_chunk
from .chunk_merger import merge_chunks
from .confidence import determine_confidence_threshold
from .config import ALWAYS_KEEP_RAW_CHUNKS, MIN_REFINEMENT_WORD_KEEP_RATIO, MODEL_ALIGN_EN
from .drift_clamp import clamp_alignment_drift
from .dual_scorer import compute_dual_score
from .hindi_normalizer import normalize_hindi_text
from .lang_detector import detect_language
from .llm_judge import refine_transcript
from .lm_check import lightweight_lm_check
from .logger import PipelineLogger
from .quality_estimator import adaptive_thresholds, measure_audio_quality
from .renderer import CaptionCueValidationError, generate_srt, generate_vtt
from .sentence_splitter import split_sentences_v2
from .sync.aligned_words import (
    assign_alignment_groups_from_speech_gaps,
    build_segments_from_aligned_words,
    canonical_aligned_words_from_segments,
    sanitize_aligned_word_ranges,
)
from .sync.auto_sync import apply_auto_sync_if_confident
from .sync.final_quality_gate import (
    TimingQualityError,
    has_timed_caption_content,
    validate_final_timing_quality,
)
from .sync.report import SyncPassResult, build_sync_report
from .sync.stable_refine import (
    apply_stable_refinement,
    resolved_stable_ts_config,
    stable_ts_available,
)
from .sync.pause_preserver import preserve_detected_pauses
from .pipeline_config import resolve_pipeline_config, resolve_pipeline_config_with_sources
from .timing import (
    PRODUCTION_INVALID_TIMING_SOURCES,
    alignment_provider_status,
    annotate_word_timing_sources,
    build_timing_report,
    detect_silence_gaps,
    normalize_timing_source,
)
from .transcriber import (
    _configured_provider_sequence,
    resolved_stt_provider,
    transcribe_audio,
    transcribe_sarvam_chunks_bounded,
)
try:
    from server.transcription_control import coerce_snapshot
except Exception:  # pragma: no cover - direct script execution fallback
    coerce_snapshot = lambda value: None
from .language_modes import (
    CODE_MIXED_LANGUAGE_MODES,
    normalize_caption_output,
    normalize_caption_text,
    normalize_language_mode,
)
from .output_transform import transform_segments_for_output
from .transcript_normalizer import (
    TranscriptValidationError,
    build_normalized_transcript,
    build_word_timed_transcript_from_chunks,
    normalize_aligned_segments,
)


import math


def _text_difference_count(left: str, right: str) -> int:
    shared = min(len(left), len(right))
    return sum(1 for index in range(shared) if left[index] != right[index]) + abs(
        len(left) - len(right)
    )


def should_run_stable_refinement(
    *,
    alignment_was_forced: bool,
    has_valid_provider_word_timing: bool,
) -> bool:
    """Avoid a second ASR pass when validated native word timing already exists."""
    refine_native = os.getenv(
        "REFINE_NATIVE_WORD_TIMING_WITH_STABLE_TS",
        "false",
    ).strip().lower() in {"1", "true", "yes", "on"}
    return alignment_was_forced or not has_valid_provider_word_timing or refine_native

def validate_chunk_native_timings(chunk: Any, max_duration: float, threshold: float = 0.90) -> tuple[bool, str | None, float]:
    """
    Returns (is_valid, failure_reason, native_timing_coverage)
    """
    metadata = getattr(chunk, "asr_metadata", None) or {}
    words = metadata.get("words")
    if not words or not isinstance(words, list):
        return False, "no_words_list", 0.0
    
    text = metadata.get("text") or ""
    text_words = text.split()
    word_count = len(words)
    if word_count == 0:
        return False, "empty_words_list", 0.0
    
    last_start = -0.001
    last_end = -0.001
    valid_words = 0
    
    for w in words:
        start = w.get("start")
        end = w.get("end")
        if start is None or end is None:
            return False, "missing_word_timestamps", 0.0
        try:
            start_f = float(start)
            end_f = float(end)
        except (ValueError, TypeError):
            return False, "non_numeric_timestamps", 0.0
            
        if not math.isfinite(start_f) or not math.isfinite(end_f):
            return False, "non_finite_timestamps", 0.0
        if start_f < -0.05:
            return False, "negative_timestamps", 0.0
        if end_f < start_f:
            return False, "end_before_start", 0.0
        if start_f + 0.001 < last_start or end_f + 0.001 < last_end:
            return False, "non_monotonic_timestamps", 0.0
        if max_duration is not None and end_f > max_duration + 0.35:
            return False, "outside_chunk_duration", 0.0
            
        last_start = start_f
        last_end = end_f
        valid_words += 1
        
    text_token_count = max(1, len(text_words))
    coverage = valid_words / text_token_count
    if coverage < threshold:
        return False, f"low_coverage_({coverage:.2f}_<__{threshold:.2f})", coverage
        
    return True, None, coverage


def align_chunk_with_stable_ts(chunk: Any, language_mode: str, config: dict[str, Any]) -> list[dict[str, Any]]:
    from .sync.stable_refine import force_align_provider_words
    chunk_duration = float(chunk.end_time) - float(chunk.start_time)
    dummy_segments = [{
        "start": 0.0,
        "end": chunk_duration,
        "text": chunk.final_text,
    }]
    stable_words = force_align_provider_words(
        dummy_segments,
        chunk.audio_path,
        language_mode,
        model_name=config.get("model"),
        device=config.get("device"),
    )
    offset = float(chunk.start_time)
    for w in stable_words:
        w["start"] = round(float(w["start"]) + offset, 3)
        w["end"] = round(float(w["end"]) + offset, 3)
        w["timing_source"] = "stable_ts_aligned"
        w["timingSource"] = "stable_ts_aligned"
    return stable_words


def align_chunk_with_whisperx(chunk: Any, language_mode: str, pipeline_config: Any) -> list[dict[str, Any]]:
    from .aligner import align_text
    from .config import MODEL_ALIGN_EN
    chunk_duration = float(chunk.end_time) - float(chunk.start_time)
    dummy_tokens = [{"text": chunk.final_text, "start": 0.0, "end": chunk_duration}]
    aligned_segs = align_text(
        dummy_tokens,
        chunk.audio_path,
        MODEL_ALIGN_EN,
        allow_fallback=False,
        enable_whisperx=True,
        provider="whisperx",
    )
    words = []
    for seg in aligned_segs:
        words.extend(seg.get("words") or [])
    offset = float(chunk.start_time)
    for w in words:
        w["start"] = round(float(w["start"]) + offset, 3)
        w["end"] = round(float(w["end"]) + offset, 3)
        w["timing_source"] = "whisperx_aligned"
        w["timingSource"] = "whisperx_aligned"
    return words


def _has_enough_words(source_text: str, candidate_text: str) -> bool:
    source_words = len(source_text.split())
    candidate_words = len(candidate_text.split())
    if source_words == 0:
        return candidate_words == 0

    minimum_words = max(1, int(source_words * MIN_REFINEMENT_WORD_KEEP_RATIO))
    return candidate_words >= minimum_words


def _stage_log(stage: str, **fields: Any) -> None:
    details = " ".join(f"{key}={value!r}" for key, value in fields.items())
    logger.info("pipeline_stage stage=%s %s", stage, details)


def _is_skippable_empty_micro_chunk_error(
    exc: Exception,
    *,
    chunk_duration: float,
    pause_threshold: float,
) -> bool:
    message = str(exc).lower()
    if "empty_transcript" not in message and "empty transcript" not in message:
        return False
    # A real short reply is kept whenever any provider returns text. This path
    # only handles VAD micro-ranges that every attempted provider considers
    # empty, avoiding a whole-job failure for a sub-pause noise/silence island.
    max_micro_chunk_seconds = max(0.35, min(1.0, float(pause_threshold) + 0.12))
    return 0 <= float(chunk_duration) <= max_micro_chunk_seconds


def _shift_timing_fields(value: dict[str, Any], offset: float) -> None:
    for key in ("start", "end", "sourceStart", "sourceEnd", "nativeStart", "nativeEnd"):
        if key not in value or value.get(key) is None:
            continue
        try:
            value[key] = round(max(0.0, float(value[key]) + offset), 3)
        except (TypeError, ValueError):
            continue


def _shift_segment_tree(segment: dict[str, Any], offset: float) -> dict[str, Any]:
    shifted = dict(segment)
    _shift_timing_fields(shifted, offset)
    shifted_words = []
    for word in shifted.get("words") or []:
        if not isinstance(word, dict):
            continue
        copied = dict(word)
        _shift_timing_fields(copied, offset)
        shifted_words.append(copied)
    if shifted_words:
        shifted["words"] = shifted_words
    return shifted


def _shift_speech_ranges(ranges: Any, offset: float) -> list[dict[str, Any]]:
    shifted_ranges: list[dict[str, Any]] = []
    if not isinstance(ranges, list):
        return shifted_ranges
    for item in ranges:
        if not isinstance(item, dict):
            continue
        shifted = dict(item)
        _shift_timing_fields(shifted, offset)
        shifted_ranges.append(shifted)
    return shifted_ranges


def _stable_refine_by_source_chunk(
    segments: list[dict[str, Any]],
    chunks: list[Any],
    audio_path: str,
    language_mode: str,
    config: dict[str, Any],
) -> SyncPassResult:
    chunk_by_index = {int(chunk.index): chunk for chunk in chunks}

    def resolve_chunk_index(segment: dict[str, Any]) -> int | None:
        try:
            chunk_index = int(segment.get("sourceChunkIndex"))
            if chunk_index in chunk_by_index:
                return chunk_index
        except (TypeError, ValueError):
            pass
        try:
            start = float(segment.get("start") or 0.0)
            end = float(segment.get("end") or start)
        except (TypeError, ValueError):
            return None
        midpoint = (start + end) / 2
        for candidate in chunks:
            candidate_start = float(candidate.start_time or 0.0)
            candidate_end = float(candidate.end_time or candidate_start)
            if candidate_start - 0.001 <= midpoint <= candidate_end + 0.001:
                return int(candidate.index)
        return None

    grouped: dict[int, list[tuple[int, dict[str, Any]]]] = {}
    ungrouped: list[tuple[int, dict[str, Any]]] = []
    for index, segment in enumerate(segments):
        chunk_index = resolve_chunk_index(segment)
        if chunk_index is None:
            ungrouped.append((index, segment))
            continue
        segment.setdefault("sourceChunkIndex", chunk_index)
        grouped.setdefault(chunk_index, []).append((index, segment))

    if not grouped or ungrouped:
        _stage_log(
            "stable_ts_chunk_alignment_fallback_full_audio",
            groupedSegmentCount=sum(len(items) for items in grouped.values()),
            ungroupedSegmentCount=len(ungrouped),
        )
        return apply_stable_refinement(segments, audio_path, language_mode, config=config)

    refined_by_index: dict[int, dict[str, Any]] = {}
    reports: list[dict[str, Any]] = []
    applied_words = 0
    provider_words = 0
    stable_words = 0
    matched_words = 0
    errors: list[str] = []
    rejection_samples: list[dict[str, Any]] = []
    failed_group_ids: list[str] = []
    final_modes: list[str] = []

    for chunk_index in sorted(grouped):
        chunk = chunk_by_index[chunk_index]
        offset = float(chunk.start_time or 0.0)
        chunk_duration = max(0.0, float(chunk.end_time or 0.0) - offset)
        local_segments = [
            _shift_segment_tree(segment, -offset)
            for _original_index, segment in grouped[chunk_index]
        ]
        local_config = dict(config)
        local_config["audioDurationSeconds"] = chunk_duration
        local_config["speechRanges"] = _shift_speech_ranges(config.get("speechRanges"), -offset)
        result = apply_stable_refinement(
            local_segments,
            chunk.audio_path,
            language_mode,
            config=local_config,
        )
        report = dict(result.report)
        report["sourceChunkIndex"] = chunk_index
        report["chunkStart"] = round(offset, 3)
        report["chunkEnd"] = round(float(chunk.end_time or offset), 3)
        reports.append(report)
        applied_words += int(report.get("appliedWords") or 0)
        provider_words += int(report.get("providerWordCount") or 0)
        stable_words += int(report.get("stableWordCount") or 0)
        matched_words += int(report.get("matchedWordCount") or 0)
        for sample in report.get("rejectionSamples") or []:
            if isinstance(sample, dict) and len(rejection_samples) < 20:
                copied = dict(sample)
                copied["sourceChunkIndex"] = chunk_index
                rejection_samples.append(copied)
        if report.get("errorCategory"):
            errors.append(f"chunk {chunk_index}: {report.get('errorCategory')}: {report.get('reason')}")
        for group_id in report.get("failedGroupIds") or []:
            failed_group_ids.append(f"{chunk_index}:{group_id}")
        if report.get("finalTimingQualityMode"):
            final_modes.append(str(report.get("finalTimingQualityMode")))
        for (original_index, _segment), refined_segment in zip(grouped[chunk_index], result.segments):
            refined_by_index[original_index] = _shift_segment_tree(refined_segment, offset)

    combined_segments = [refined_by_index[index] for index in range(len(segments))]
    unusable = bool(final_modes) and all(mode == "unusable" for mode in final_modes)
    applied = applied_words > 0
    combined_report = {
        "enabled": True,
        "available": True,
        "applied": applied,
        "appliedWords": applied_words,
        "providerWordCount": provider_words,
        "stableWordCount": stable_words,
        "matchedWordCount": matched_words,
        "matchCoverage": round(matched_words / max(1, provider_words), 4),
        "orderFallbackUsed": any(bool(report.get("orderFallbackUsed")) for report in reports),
        "reason": "stable-ts chunk refinement applied" if applied else "; ".join(errors) or "stable-ts chunk refinement recovered without stable matches",
        "errorCategory": "caption_timing_unusable" if unusable else None,
        "chunked": True,
        "chunkReports": reports,
        "rejectionSamples": rejection_samples,
        "failedGroupIds": failed_group_ids,
        "finalTimingQualityMode": "unusable" if unusable else ("word_timed_verified" if applied else "word_timed_estimated"),
        "verifiedWordCount": sum(int(report.get("verifiedWordCount") or 0) for report in reports),
        "estimatedWordCount": sum(int(report.get("estimatedWordCount") or 0) for report in reports),
        "phraseFallbackCueCount": sum(int(report.get("phraseFallbackCueCount") or 0) for report in reports),
        "resolvedConfiguration": reports[0].get("resolvedConfiguration") if reports else None,
    }
    if rejection_samples and errors:
        sample_summary = "; ".join(
            f"chunk {sample.get('sourceChunkIndex')} token={sample.get('providerTokenId')} reason={sample.get('reason')}"
            for sample in rejection_samples[:5]
        )
        combined_report["reason"] = f"{combined_report['reason']} samples=[{sample_summary}]"
    return SyncPassResult(combined_segments, combined_report)


def _log_caption_timing_debug(
    aligned_words: list[dict[str, Any]],
    silence_gaps: list[dict[str, Any]],
    caption_chunks: list[dict[str, Any]],
    pause_threshold: float,
) -> None:
    qualifying_gaps = [
        gap
        for gap in silence_gaps
        if float(gap.get("end") or 0) - float(gap.get("start") or 0) >= pause_threshold
    ]
    crossing_chunks: list[dict[str, Any]] = []
    for chunk in caption_chunks:
        chunk_start = float(chunk.get("start") or 0)
        chunk_end = float(chunk.get("end") or 0)
        for gap in qualifying_gaps:
            gap_start = float(gap.get("start") or 0)
            gap_end = float(gap.get("end") or 0)
            if chunk_start < gap_start and chunk_end > gap_end:
                crossing_chunks.append(
                    {
                        "start": chunk_start,
                        "end": chunk_end,
                        "silenceStart": gap_start,
                        "silenceEnd": gap_end,
                    }
                )

    estimated_words = [
        word
        for word in aligned_words
        if any(
            marker in str(
                word.get("timingSourceDetail")
                or word.get("timing_source")
                or word.get("timingSource")
                or ""
            ).lower()
            for marker in ("estimated", "interpolated", "synthetic", "fallback")
        )
    ]
    logger.info(
        "caption_timing_debug alignedWordTimingsFirst50=%r",
        [
            {
                "start": word.get("start"),
                "end": word.get("end"),
                "timing_source": word.get("timingSourceDetail")
                or word.get("timing_source")
                or word.get("timingSource"),
            }
            for word in aligned_words[:50]
        ],
    )


def _chunk_has_provider_words(chunk: Any) -> bool:
    metadata = getattr(chunk, "asr_metadata", None) or {}
    if metadata.get("nativeWordsAvailable") is False:
        return False
    granularity = str(metadata.get("timing_granularity") or metadata.get("timingGranularity") or "").lower()
    if granularity == "phrase":
        return False
    basis = str(metadata.get("timestamp_basis") or metadata.get("timestampBasis") or "").lower()
    if basis == "none":
        return False
    words = metadata.get("words") or []
    if not isinstance(words, list) or not words:
        return False
    for word in words:
        if bool((word or {}).get("preservePhraseTiming")):
            return False
        source = str(
            (word or {}).get("timingSource")
            or (word or {}).get("timing_source")
            or ""
        ).lower()
        if source not in {"provider_native", "provider_native_word", "provider_word_chunk_local", "provider_word_absolute"}:
            return False
        if "structured" in source:
            return False
        if any(marker in source for marker in ("estimated", "interpolated", "synthetic", "segment_derived", "phrase", "fallback")):
            return False
    return True


def _chunks_have_provider_words(chunks: list[Any]) -> bool:
    text_chunks = [chunk for chunk in chunks if str(getattr(chunk, "final_text", "") or getattr(chunk, "raw_text", "") or "").strip()]
    if not text_chunks:
        return False
    return any(_chunk_has_provider_words(chunk) for chunk in text_chunks)


def _chunks_all_have_provider_words(chunks: list[Any]) -> bool:
    text_chunks = [chunk for chunk in chunks if str(getattr(chunk, "final_text", "") or getattr(chunk, "raw_text", "") or "").strip()]
    return bool(text_chunks) and all(_chunk_has_provider_words(chunk) for chunk in text_chunks)


def _chunks_have_any_provider_words(chunks: list[Any]) -> bool:
    text_chunks = [chunk for chunk in chunks if str(getattr(chunk, "final_text", "") or getattr(chunk, "raw_text", "") or "").strip()]
    if not text_chunks:
        return False
    for chunk in text_chunks:
        metadata = getattr(chunk, "asr_metadata", None) or {}
        basis = str(metadata.get("timestamp_basis") or metadata.get("timestampBasis") or "").lower()
        if basis == "none":
            return False
        words = metadata.get("words") or []
        if not isinstance(words, list) or not words:
            return False
    return True


def _chunks_have_non_word_provider_timing(chunks: list[Any]) -> bool:
    for chunk in chunks:
        metadata = getattr(chunk, "asr_metadata", None) or {}
        if metadata.get("nativeWordsAvailable") is False:
            return True
        granularity = str(metadata.get("timing_granularity") or metadata.get("timingGranularity") or "").lower()
        if granularity == "phrase":
            return True
        for word in metadata.get("words") or []:
            if bool((word or {}).get("preservePhraseTiming")):
                return True
            source = str(
                (word or {}).get("timingSource")
                or (word or {}).get("timing_source")
                or ""
            ).lower()
            if source == "provider_phrase":
                return True
    return False


def _caption_chunking_rules(config: Any) -> dict[str, Any]:
    chunking = config.captionChunking
    return {
        "target_words": chunking.targetWords,
        "max_words": chunking.maxWords,
        "min_words": chunking.minWords,
        "max_chars": chunking.maxCharacters,
        "min_duration": chunking.minDurationSeconds,
        "max_duration": chunking.maxDurationSeconds,
        "pause_split_threshold": chunking.pauseSplitThresholdSeconds,
        "merge_gap": chunking.mergeGapSeconds,
        "phrase_hold": chunking.phraseHoldSeconds,
    }


def _mark_segments_realigned(segments: list[dict[str, Any]], *, provider: str) -> list[dict[str, Any]]:
    for segment in segments:
        for word in segment.get("words") or []:
            detailed_source = (
                word.get("timingSourceDetail")
                or word.get("timingSource")
                or word.get("timing_source")
                or provider
            )
            normalized_source = normalize_timing_source(detailed_source, word.get("provider"))
            if normalized_source in PRODUCTION_INVALID_TIMING_SOURCES:
                word["timingProvenance"] = "estimated"
                word["timingSourceDetail"] = detailed_source
                word["timingSource"] = detailed_source
                word["timing_source"] = normalized_source
                word["timingSourceCategory"] = normalized_source
                word["timingNeedsReview"] = True
                word["timingReviewRequired"] = True
                word["timingWarning"] = word.get("timingWarning") or "Estimated word timing; alignment did not produce a real timestamp."
                continue
            realigned_source = normalize_timing_source(provider, word.get("provider"))
            word["timingProvenance"] = "realigned"
            word["timingSourceDetail"] = detailed_source
            word["timingSource"] = detailed_source or provider
            word["timing_source"] = realigned_source
            word["timingSourceCategory"] = realigned_source
    return segments


def run_pipeline(
    video_path: str,
    user_target_lang: str = "english",
    caption_output: str = "original",
    transcription_config_snapshot: dict[str, Any] | None = None,
    progress_callback=None,
    source_in_ms: int | None = None,
    source_out_ms: int | None = None,
    timeline_offset_ms: int | None = None,
) -> Dict[str, Any]:
    """Run transcription, normalization, alignment, and subtitle export."""
    language_mode = normalize_language_mode(user_target_lang)
    output_language = normalize_caption_output(caption_output)
    pipeline_logger = PipelineLogger(os.path.basename(video_path))
    pipeline_logger.start_run()
    audio_path = f"{os.path.splitext(video_path)[0]}_temp.wav"
    chunks = []
    transcription_providers: set[str] = set()
    transcription_fallback_from: set[str] = set()
    active_snapshot = coerce_snapshot(transcription_config_snapshot)
    raw_snapshot = transcription_config_snapshot if isinstance(transcription_config_snapshot, dict) else {}
    try:
        snapshot_offset_us = int(raw_snapshot.get("timeline_offset_us", raw_snapshot.get("timelineOffsetUs", 0)) or 0)
    except (TypeError, ValueError):
        snapshot_offset_us = 0
    try:
        timeline_duration_us = int(raw_snapshot.get("timeline_duration_us", raw_snapshot.get("timelineDurationUs", 0)) or 0)
    except (TypeError, ValueError):
        timeline_duration_us = 0
    audio_origin = str(raw_snapshot.get("audio_origin", raw_snapshot.get("audioOrigin", "source_media")))
    pipeline_options_snapshot = active_snapshot.resolved_pipeline_options if active_snapshot else None
    pipeline_config = resolve_pipeline_config(pipeline_options_snapshot)
    pipeline_config_with_sources = resolve_pipeline_config_with_sources(pipeline_options_snapshot)
    pipeline_option_sources = (
        active_snapshot.pipeline_option_sources
        if active_snapshot and isinstance(active_snapshot.pipeline_option_sources, dict) and active_snapshot.pipeline_option_sources
        else pipeline_config_with_sources.get("sources")
    )
    debug_segments: list[dict[str, Any]] = []
    debug_aligned_words: list[dict[str, Any]] = []
    debug_sync_report: dict[str, Any] = {}
    debug_timing_report: dict[str, Any] = {}
    debug_vad_report: dict[str, Any] = {}
    job_needs_review = False

    def emit_progress(status: str, percent: int, details: str = ""):
        logger.info(f"Progress: {percent}% - {status} - {details}")
        if progress_callback:
            progress_callback(status, percent, details)

    try:
        _stage_log(
            "resolved_timing_configuration",
            preset_id=active_snapshot.preset_id if active_snapshot else None,
            preset_version=active_snapshot.preset_version if active_snapshot else None,
            resolved=pipeline_config_with_sources.get("resolved"),
            sources=pipeline_option_sources,
        )
        _stage_log("audio extraction started", video_path=video_path, language_mode=language_mode)
        emit_progress("extracting_audio", 5, "Extracting audio from uploaded video.")
        audio_options = pipeline_config.audio
        extract_audio(
            video_path,
            audio_path,
            sample_rate=16000,
            channels=1,
            codec="pcm_s16le",
            start_ms=source_in_ms,
            end_ms=source_out_ms,
        )
        _stage_log("audio extraction completed", audio_path=audio_path, language_mode=language_mode)

        emit_progress("normalizing", 10, "Estimating audio quality.")
        metrics = measure_audio_quality(audio_path)
        timing_provider_status = alignment_provider_status()
        transcript_aligner = TranscriptAligner(
            enable_silero_vad=pipeline_config.vad.sileroEnabled,
            enable_stable_ts=pipeline_config.alignment.stableTsEnabled,
            enable_whisperx=pipeline_config.alignment.whisperxEnabled,
            pause_threshold=pipeline_config.vad.pauseThresholdSeconds,
            silero_speech_threshold=pipeline_config.vad.sileroSpeechThreshold,
            silero_min_speech_duration_ms=pipeline_config.vad.sileroMinSpeechDurationMs,
            silero_min_silence_duration_ms=pipeline_config.vad.sileroMinSilenceDurationMs,
            silero_speech_pad_ms=pipeline_config.vad.sileroSpeechPadMs,
        )
        timing_provider_status["transcriptAligner"] = transcript_aligner.status()
        vad_report = detect_silence_gaps(
            audio_path,
            min_silence=transcript_aligner.pause_threshold,
            threshold_db=(
                f"{pipeline_config.vad.silenceThresholdDb}dB"
                if pipeline_config.vad.silenceThresholdDb is not None
                else None
            ),
            silero_enabled=pipeline_config.vad.sileroEnabled,
            silero_speech_threshold=pipeline_config.vad.sileroSpeechThreshold,
            silero_min_speech_duration_ms=pipeline_config.vad.sileroMinSpeechDurationMs,
            silero_min_silence_duration_ms=pipeline_config.vad.sileroMinSilenceDurationMs,
            silero_speech_pad_ms=pipeline_config.vad.sileroSpeechPadMs,
        )
        adaptive_thresholds_dict = adaptive_thresholds(metrics["snr_db"], metrics["speech_rate"])
        logger.info(f"Adaptive Thresholds Applied: {adaptive_thresholds_dict}")

        emit_progress("normalizing", 15, "Chunking audio for transcription.")
        is_strict = metrics["snr_db"] < 10.0
        chunking_options = pipeline_config.audioChunking
        chunks = overlap_chunk(
            audio_path,
            mode="strict" if is_strict else "normal",
            speech_segments=vad_report.get("paddedSpeechRanges") or vad_report.get("speechSegments") or [],
            vad_enabled=chunking_options.vadEnabled,
            target_seconds=chunking_options.targetSeconds,
            max_seconds=chunking_options.maxSeconds,
            padding_seconds=chunking_options.paddingSeconds,
            legacy_seconds=chunking_options.legacyStrictSeconds if is_strict else chunking_options.legacyNormalSeconds,
            legacy_overlap_seconds=chunking_options.legacyStrictOverlapSeconds if is_strict else chunking_options.legacyNormalOverlapSeconds,
        )
        total_chunks = max(len(chunks), 1)
        processed_chunks = []

        emit_progress("transcribing", 18, f"Transcribing {len(chunks)} audio chunk(s).")
        _stage_log("transcription started", chunk_count=len(chunks), language_mode=language_mode)

        for chunk in chunks:
            apply_fade(chunk.audio_path, fade_ms=pipeline_config.audioChunking.fadeMs)

        parallel_results: list[dict] | None = None
        selected_provider = active_snapshot.provider if active_snapshot else resolved_stt_provider(language_mode)
        if selected_provider == "sarvam" and len(chunks) > 1:
            parallel_results = asyncio.run(
                transcribe_sarvam_chunks_bounded(
                    [chunk.audio_path for chunk in chunks],
                    language_mode,
                    transcription_config_snapshot=transcription_config_snapshot,
                    # The pipeline worker owns a separate event loop for DB and
                    # WebSocket progress. Calling that callback from inside this
                    # temporary Sarvam loop would nest run_until_complete().
                    progress_callback=None,
                )
            )
            emit_progress(
                "transcribing",
                66,
                f"Transcribed {len(chunks)}/{len(chunks)} audio chunks.",
            )

        for i, chunk in enumerate(chunks):
            chunk_pct = 18 + int((i / total_chunks) * 48)
            if parallel_results is None:
                provider_order = [active_snapshot.provider] if active_snapshot else _configured_provider_sequence()
                provider_label = (provider_order[0] if provider_order else "provider").replace("_", " ").title()
                emit_progress("transcribing", chunk_pct, f"Transcribing chunk {i + 1} of {len(chunks)} with {provider_label}.")

            def on_provider_progress(event: str, provider: str, category: str | None = None):
                provider_label = provider.replace("_", " ").title()
                if event == "attempt":
                    emit_progress(
                        "transcribing",
                        chunk_pct,
                        f"Transcribing chunk {i + 1} of {len(chunks)} with {provider_label}.",
                    )
                elif event == "failed":
                    fallback_order = [active_snapshot.provider] if active_snapshot else _configured_provider_sequence()
                    next_provider = None
                    if provider in fallback_order:
                        provider_position = fallback_order.index(provider)
                        if provider_position + 1 < len(fallback_order):
                            next_provider = fallback_order[provider_position + 1]
                    if next_provider:
                        next_label = next_provider.replace("_", " ").title()
                        reason = "timed out" if category == "timeout" else "failed"
                        emit_progress(
                            "transcribing",
                            chunk_pct,
                            f"{provider_label} {reason}; trying {next_label} for chunk {i + 1} of {len(chunks)}.",
                        )

            try:
                transcription_result = (
                    parallel_results[i]
                    if parallel_results is not None
                    else transcribe_audio(
                        chunk.audio_path,
                        language_mode=language_mode,
                        progress_callback=on_provider_progress,
                        chunk_index=i + 1,
                        total_chunks=len(chunks),
                        transcription_config_snapshot=transcription_config_snapshot,
                    )
                )
                if isinstance(transcription_result, dict) and transcription_result.get("__transcription_error__"):
                    raise RuntimeError(str(transcription_result.get("__transcription_error__")))
            except RuntimeError as exc:
                chunk_duration = max(0.0, float(chunk.end_time or 0.0) - float(chunk.start_time or 0.0))
                if _is_skippable_empty_micro_chunk_error(
                    exc,
                    chunk_duration=chunk_duration,
                    pause_threshold=transcript_aligner.pause_threshold,
                ):
                    chunk.raw_text = ""
                    chunk.final_text = ""
                    chunk.score = 0.0
                    chunk.asr_metadata = {
                        "provider": "none",
                        "text": "",
                        "providerRawText": "",
                        "nativeWordsAvailable": False,
                        "timing_granularity": "missing",
                        "skipped": True,
                        "skipReason": "empty_transcript_micro_chunk",
                        "chunkDurationSeconds": round(chunk_duration, 3),
                    }
                    processed_chunks.append(chunk)
                    _stage_log(
                        "empty_micro_chunk_skipped",
                        chunk_index=i,
                        duration=round(chunk_duration, 3),
                        pause_threshold=transcript_aligner.pause_threshold,
                        reason=str(exc)[:240],
                    )
                    continue
                raise
            transcription_providers.add(str(transcription_result.get("provider") or "unknown"))
            if transcription_result.get("fallback") and transcription_result.get("fallback_from"):
                fallback_from = transcription_result.get("fallback_from")
                if isinstance(fallback_from, list):
                    transcription_fallback_from.update(str(provider) for provider in fallback_from)
                else:
                    transcription_fallback_from.add(str(fallback_from))
            raw_text = transcription_result.get("text", "")
            clean_text = normalize_caption_text(raw_text, language_mode)
            normalization_difference_count = _text_difference_count(
                str(raw_text or ""),
                clean_text,
            )
            chunk.raw_text = clean_text
            chunk.asr_metadata = {
                **transcription_result,
                "providerRawText": transcription_result.get("providerRawText") or raw_text,
                "normalizedText": clean_text,
                "displayText": clean_text,
                "normalizationDifferenceCount": normalization_difference_count,
                "sourceLanguage": language_mode,
                "outputLanguage": output_language,
            }
            if str(transcription_result.get("provider") or "").lower() == "sarvam":
                native_available = bool(transcription_result.get("nativeWordsAvailable"))
                _stage_log(
                    "sarvam_transcript_succeeded",
                    chunk_index=i,
                    mode=transcription_result.get("provider_mode"),
                    language_code=transcription_result.get("provider_language_code"),
                    timing_granularity=transcription_result.get("timing_granularity"),
                    native_words_available=native_available,
                    native_word_count=transcription_result.get("nativeWordCount"),
                    phrase_entry_count=transcription_result.get("phraseEntryCount"),
                    request_id=transcription_result.get("provider_request_id") or transcription_result.get("request_id"),
                    normalization_difference_count=normalization_difference_count,
                )
                if not native_available:
                    _stage_log(
                        "native_words_unavailable",
                        chunk_index=i,
                        category=transcription_result.get("nativeTimingFailureCategory"),
                        timing_granularity=transcription_result.get("timing_granularity"),
                    )
            score = float(transcription_result.get("language_probability") or 1.0)

            if not clean_text.strip():
                processed_chunks.append(chunk)
                continue

            if language_mode in CODE_MIXED_LANGUAGE_MODES or language_mode == "telugu":
                chunk.language = language_mode
                chunk.final_text = clean_text
                chunk.score = score
                pipeline_logger.log_chunk(
                    index=i,
                    lang=language_mode,
                    raw=clean_text,
                    refined=clean_text,
                    final=chunk.final_text,
                    score=score,
                )
                processed_chunks.append(chunk)
                continue

            detected_lang = detect_language(clean_text.split())
            chunk.language = detected_lang
            scoring_text = clean_text

            if detected_lang in ("hindi", "hinglish", "hi") or language_mode == "hinglish":
                scoring_text = normalize_hindi_text(clean_text, lang=detected_lang)

            llm_mode = "critical" if is_strict else "normal"
            try:
                refined_text = refine_transcript(
                    scoring_text,
                    detected_lang,
                    mode=llm_mode,
                    target_lang=language_mode,
                )
                refined_text = normalize_caption_text(refined_text, language_mode)
            except Exception as exc:
                logger.warning(f"Chunk {i} LLM refinement failed: {exc}. Using unrefined text.")
                refined_text = scoring_text

            if language_mode == "hinglish":
                pass
            elif not check_hallucination(scoring_text, refined_text):
                logger.warning(f"Chunk {i} failed hallucination guard. Falling back to raw text.")
                refined_text = scoring_text

            keeps_enough_words = _has_enough_words(clean_text, refined_text)

            if language_mode == "hinglish":
                score = 1.0
                chunk.final_text = refined_text if keeps_enough_words else clean_text
            else:
                lm_score = lightweight_lm_check(refined_text, detected_lang)
                confidence_threshold = determine_confidence_threshold(
                    refined_text,
                    adaptive_thresholds_dict,
                )
                score = lm_score if lm_score > 0.9 else compute_dual_score(clean_text, refined_text)

                if score >= confidence_threshold and keeps_enough_words:
                    chunk.final_text = refined_text
                else:
                    logger.info(
                        f"Chunk {i} using maximum-recall fallback. "
                        f"Score={score:.2f}, Threshold={confidence_threshold:.2f}, "
                        f"WordKeep={keeps_enough_words}"
                    )
                    chunk.final_text = scoring_text or clean_text

            chunk.score = score
            if ALWAYS_KEEP_RAW_CHUNKS and not chunk.final_text.strip():
                chunk.final_text = clean_text

            pipeline_logger.log_chunk(
                index=i,
                lang=detected_lang,
                raw=clean_text,
                refined=refined_text,
                final=chunk.final_text,
                score=score,
            )
            processed_chunks.append(chunk)

        _stage_log("transcription completed", chunk_count=len(processed_chunks))

        # Check and repair chunks with invalid timings
        for i, chunk in enumerate(processed_chunks):
            if chunk.asr_metadata.get("skipped") or not chunk.final_text.strip():
                continue
            
            chunk_duration = max(0.0, float(chunk.end_time or 0.0) - float(chunk.start_time or 0.0))
            is_valid, reason, coverage = validate_chunk_native_timings(
                chunk,
                chunk_duration,
                threshold=pipeline_config.quality.minimumProviderTimestampCoverage
            )
            
            chunk.asr_metadata["timing_validation"] = {
                "chunk_id": i,
                "source_start_ms": int(float(chunk.start_time) * 1000),
                "source_end_ms": int(float(chunk.end_time) * 1000),
                "provider": chunk.asr_metadata.get("provider", "unknown"),
                "text": chunk.final_text,
                "words": chunk.asr_metadata.get("words") or [],
                "native_timing_coverage": coverage,
                "timing_valid": is_valid,
                "timing_failure_reasons": [reason] if reason else [],
                "attempt_count": chunk.asr_metadata.get("retry_attempts_count", 1),
                "latency_ms": chunk.asr_metadata.get("latency_ms", 0),
            }
            
            if is_valid:
                chunk.asr_metadata["timing_provenance"] = "provider_native"
                for w in chunk.asr_metadata.get("words", []):
                    w["timing_source"] = "provider_native"
                    w["timingSource"] = "provider_native"
            else:
                repaired_words = None
                
                fast_fallback_enabled = os.getenv("CAPTION_FAST_FALLBACK_ENABLED", "false").strip().lower() == "true"
                if pipeline_config.preset == "fast" and not fast_fallback_enabled:
                    run_stable_ts = False
                    run_whisperx = False
                else:
                    run_stable_ts = pipeline_config.alignment.stableTsFallbackEnabled
                    run_whisperx = pipeline_config.alignment.whisperxFallbackEnabled
                
                if run_stable_ts:
                    try:
                        logger.info("Repairing chunk %d using Stable TS...", i)
                        repaired_words = align_chunk_with_stable_ts(
                            chunk,
                            language_mode,
                            {
                                "model": pipeline_config.alignment.stableTsModel,
                                "device": pipeline_config.alignment.stableTsDevice,
                            }
                        )
                        chunk.asr_metadata["timing_provenance"] = "stable_ts_aligned"
                    except Exception as e:
                        logger.warning("Stable TS repair failed for chunk %d: %s", i, e)
                        
                if repaired_words is None and run_whisperx:
                    try:
                        logger.info("Repairing chunk %d using WhisperX...", i)
                        repaired_words = align_chunk_with_whisperx(
                            chunk,
                            language_mode,
                            pipeline_config
                        )
                        chunk.asr_metadata["timing_provenance"] = "whisperx_aligned"
                    except Exception as e:
                        logger.warning("WhisperX repair failed for chunk %d: %s", i, e)
                        
                if repaired_words is not None:
                    chunk.asr_metadata["words"] = repaired_words
                    chunk.asr_metadata["nativeWordsAvailable"] = True
                else:
                    logger.info("Falling back to deterministic estimation for chunk %d", i)
                    estimated_words = []
                    words_text = chunk.final_text.split()
                    if words_text:
                        seg_dur = chunk_duration / len(words_text)
                        for idx, w_txt in enumerate(words_text):
                            w_start = float(chunk.start_time) + idx * seg_dur
                            w_end = float(chunk.start_time) + (idx + 1) * seg_dur
                            estimated_words.append({
                                "word": w_txt,
                                "start": round(w_start, 3),
                                "end": round(w_end, 3),
                                "timing_source": "degraded" if (pipeline_config.preset == "fast" and not fast_fallback_enabled) else "deterministic_estimate",
                                "timingSource": "degraded" if (pipeline_config.preset == "fast" and not fast_fallback_enabled) else "deterministic_estimate",
                                "timingReviewRequired": True,
                            })
                    chunk.asr_metadata["words"] = estimated_words
                    chunk.asr_metadata["nativeWordsAvailable"] = False
                    chunk.asr_metadata["timing_provenance"] = "degraded" if (pipeline_config.preset == "fast" and not fast_fallback_enabled) else "deterministic_estimate"
                    job_needs_review = True

        emit_progress("romanizing", 70, "Romanizing and validating transcript text.")

        chunk_audit: list[dict[str, Any]] = []
        has_provider_word_timing = _chunks_have_provider_words(processed_chunks)
        all_chunks_have_provider_word_timing = _chunks_all_have_provider_words(processed_chunks)
        has_any_provider_word_timing = _chunks_have_any_provider_words(processed_chunks)
        has_non_word_provider_timing = _chunks_have_non_word_provider_timing(processed_chunks)
        alignment_was_forced = False
        use_provider_word_timing = (
            pipeline_config.timingSourcePolicy != "forced"
            and (
                has_provider_word_timing
                or (
                    has_any_provider_word_timing
                    and not has_non_word_provider_timing
                    and pipeline_config.timingSourcePolicy == "estimated_debug_only"
                )
            )
        )
        if pipeline_config.timingSourcePolicy == "native_required" and not all_chunks_have_provider_word_timing:
            raise TranscriptValidationError(
                "Configured timing policy requires native provider word timestamps, but the provider did not return them."
            )
        if use_provider_word_timing:
            clamped_segments = build_word_timed_transcript_from_chunks(
                processed_chunks,
                language_mode,
                speech_segments=vad_report.get("speechSegments") or [],
                chunk_audit=chunk_audit,
                pipeline_config=pipeline_config,
            )
            _stage_log(
                "provider word timestamps preserved",
                timing_source_policy=pipeline_config.timingSourcePolicy,
                chunk_count=len(processed_chunks),
            )
        else:
            alignment_was_forced = True
            if pipeline_config.timingSourcePolicy == "native_required":
                raise TranscriptValidationError(
                    "Configured timing policy requires native provider word timestamps, but native timing was unavailable."
                )
            if has_non_word_provider_timing:
                _stage_log(
                    "provider_phrase_timing_ignored",
                    timing_source_policy=pipeline_config.timingSourcePolicy,
                    reason="non-word provider timing cannot satisfy caption timing",
                )
            merged_text, merged_segments = merge_chunks(processed_chunks)
            _stage_log(
                "forced_alignment_started",
                timing_source_policy=pipeline_config.timingSourcePolicy,
                provider=pipeline_config.alignment.provider,
                stable_ts_enabled=pipeline_config.alignment.stableTsEnabled,
                stable_ts_model=pipeline_config.alignment.stableTsModel,
                merged_word_count=len(merged_text.split()),
            )
            _stage_log(
                "word timestamps normalized",
                merged_word_count=len(merged_text.split()),
                segment_count=len(merged_segments),
            )

            emit_progress("chunking", 80, "Splitting caption sentences.")
            prompt_segments_with_time = []

            for merged_segment_index, seg in enumerate(merged_segments):
                seg_sents = split_sentences_v2(seg["text"], strict=is_strict)
                if not seg_sents:
                    continue

                word_counts = [max(len(s.split()), 1) for s in seg_sents]
                total_words = sum(word_counts)
                seg_total_dur = seg["end"] - seg["start"]
                cursor = seg["start"]
                source_segment_index = seg.get("sourceSegmentIndex", merged_segment_index)
                source_start = seg.get("sourceStart", seg["start"])
                source_end = seg.get("sourceEnd", seg["end"])

                for sent_index, sent in enumerate(seg_sents):
                    frac = word_counts[sent_index] / total_words
                    sent_dur = seg_total_dur * frac
                    sent_start = round(cursor, 3)
                    sent_end = round(cursor + sent_dur, 3)
                    prompt_segments_with_time.append(
                        {
                            "text": sent,
                            "start": sent_start,
                            "end": sent_end,
                            "sourceSegmentIndex": source_segment_index,
                            "sourceChunkIndex": seg.get("sourceChunkIndex"),
                            "sourceStart": source_start,
                            "sourceEnd": source_end,
                        }
                    )
                    cursor += sent_dur

            emit_progress("normalizing", 85, "Aligning every visible word.")
            try:
                aligned_segments = align_text(
                    prompt_segments_with_time,
                    audio_path,
                    MODEL_ALIGN_EN,
                    allow_fallback=(
                        pipeline_config.timingSourcePolicy == "estimated_debug_only"
                        or pipeline_config.alignment.stableTsEnabled
                    ),
                    enable_whisperx=pipeline_config.alignment.whisperxEnabled,
                    provider=pipeline_config.alignment.provider,
                )
            except Exception as e:
                logger.error(f"Alignment fully failed: {e}. Cannot generate timestamps.")
                raise

            for aligned_segment, prompt_segment in zip(aligned_segments, prompt_segments_with_time):
                for metadata_key in ("sourceSegmentIndex", "sourceChunkIndex", "sourceStart", "sourceEnd"):
                    if prompt_segment.get(metadata_key) is not None and aligned_segment.get(metadata_key) is None:
                        aligned_segment[metadata_key] = prompt_segment.get(metadata_key)

            clamped_segments = []
            for seg in aligned_segments:
                if "words" in seg:
                    seg["words"] = clamp_alignment_drift(seg["words"])
                clamped_segments.append(seg)

            for i in range(1, len(clamped_segments)):
                prev = clamped_segments[i - 1]
                curr = clamped_segments[i]
                if "start" in curr and "end" in prev and curr["start"] < prev["end"]:
                    mid = (prev["end"] + curr["start"]) / 2
                    prev["end"] = round(mid - 0.005, 3)
                    curr["start"] = round(mid + 0.005, 3)

            is_valid = validate_alignment(clamped_segments, adaptive_thresholds_dict)
            if not is_valid:
                logger.warning("Alignment validation failed. Output may have misaligned tokens.")
            else:
                _stage_log(
                    "forced_alignment_validation_passed",
                    segment_count=len(clamped_segments),
                )

            clamped_segments = normalize_aligned_segments(clamped_segments, language_mode)

        if not has_timed_caption_content(clamped_segments):
            raise TranscriptValidationError(
                "no_timed_caption_content: Caption transcription produced no usable timed speech. "
                "Check that the selected media has an audible speech track and retry."
            )

        emit_progress("normalizing", 88, "Optimizing word-level timestamps.")
        if alignment_was_forced and pipeline_config.alignment.stableTsEnabled:
            _stage_log(
                "legacy_timestamp_optimizer_skipped",
                reason="canonical stable-ts forced alignment owns timing",
            )
        else:
            try:
                clamped_segments = transcript_aligner.optimize_segments(audio_path, clamped_segments, language_mode)
            except Exception as exc:
                logger.warning(
                    "Local timestamp optimization failed for %s: %s. Continuing with existing timestamps.",
                    audio_path,
                    exc,
                )

        run_stable_refinement = should_run_stable_refinement(
            alignment_was_forced=alignment_was_forced,
            has_valid_provider_word_timing=use_provider_word_timing,
        )
        emit_progress(
            "normalizing",
            89,
            "Aligning caption timing to speech."
            if run_stable_refinement
            else "Validating caption timing and speech pauses.",
        )
        hard_speech_gaps = vad_report.get("hardSpeechGaps") or vad_report.get("silenceGaps") or []
        clamped_segments, pre_refine_group_report = assign_alignment_groups_from_speech_gaps(
            clamped_segments,
            hard_speech_gaps,
            pause_threshold=transcript_aligner.pause_threshold,
        )
        try:
            if pipeline_config.alignment.stableTsEnabled and run_stable_refinement:
                _stage_log("stable_ts_model_loading", model=pipeline_config.alignment.stableTsModel)
            stable_config = {
                "enabled": pipeline_config.alignment.stableTsEnabled,
                "model": pipeline_config.alignment.stableTsModel,
                "device": pipeline_config.alignment.stableTsDevice,
                "minMatchCoverage": pipeline_config.alignment.stableTsMinMatchCoverage,
                "minWordRatio": pipeline_config.alignment.stableTsMinWordRatio,
                "maxWordRatio": pipeline_config.alignment.stableTsMaxWordRatio,
                "allowOrderFallback": pipeline_config.alignment.allowStableTsOrderFallback,
                "maxAudioSeconds": pipeline_config.performance.stableTsMaxAudioSeconds,
                "audioDurationSeconds": vad_report.get("audioDuration"),
                "speechRanges": vad_report.get("speechRanges") or vad_report.get("paddedSpeechRanges") or hard_speech_gaps,
            }
            resolved_stable_config = resolved_stable_ts_config(stable_config)
            _stage_log(
                "stable_ts_resolved_configuration",
                **resolved_stable_config,
                model=pipeline_config.alignment.stableTsModel,
                device=pipeline_config.alignment.stableTsDevice,
            )
            audio_duration = vad_report.get("audioDuration")
            use_chunked_stable_ts = (
                pipeline_config.alignment.stableTsEnabled
                and audio_duration is not None
                and float(audio_duration) > float(pipeline_config.performance.stableTsMaxAudioSeconds)
                and len(chunks) > 1
            )
            if not run_stable_refinement:
                stable_result = SyncPassResult(
                    clamped_segments,
                    {
                        "enabled": False,
                        "configuredEnabled": pipeline_config.alignment.stableTsEnabled,
                        "available": stable_ts_available(),
                        "applied": False,
                        "appliedWords": 0,
                        "reason": "validated provider-native word timestamps retained",
                        "finalTimingQualityMode": "word_timed_verified",
                        "nativeTimingFastPath": True,
                        "warnings": [],
                    },
                )
                _stage_log(
                    "stable_ts_alignment_skipped",
                    reason="validated_provider_native_word_timestamps",
                )
            elif use_chunked_stable_ts:
                _stage_log(
                    "stable_ts_chunk_alignment_started",
                    chunk_count=len(chunks),
                    audioDurationSeconds=round(float(audio_duration), 3),
                    maxAudioSeconds=pipeline_config.performance.stableTsMaxAudioSeconds,
                )
                stable_result = _stable_refine_by_source_chunk(
                    clamped_segments,
                    chunks,
                    audio_path,
                    language_mode,
                    stable_config,
                )
            else:
                stable_result = apply_stable_refinement(
                    clamped_segments,
                    audio_path,
                    language_mode,
                    config=stable_config,
                )
            clamped_segments = stable_result.segments
            if pipeline_config.alignment.stableTsEnabled and run_stable_refinement:
                _stage_log(
                    "stable_ts_alignment_completed",
                    applied=stable_result.report.get("applied"),
                    reason=stable_result.report.get("reason"),
                )
        except Exception as exc:
            logger.warning("stable-ts sync refinement failed safely: %s", exc)
            stable_result = SyncPassResult(clamped_segments, {"applied": False, "reason": str(exc), "warnings": [str(exc)]})
        stable_result.report.setdefault("selectedProvider", active_snapshot.provider if active_snapshot else ",".join(sorted(transcription_providers)) or "unknown")
        stable_result.report.setdefault("selectedModel", active_snapshot.model if active_snapshot else None)
        stable_result.report.setdefault("timingPreset", active_snapshot.preset_id if active_snapshot else None)
        stable_result.report.setdefault("configurationSnapshot", active_snapshot.to_dict() if active_snapshot else pipeline_config.to_dict())
        if alignment_was_forced:
            final_timing_mode = str(stable_result.report.get("finalTimingQualityMode") or "")
            if pipeline_config.alignment.stableTsEnabled and final_timing_mode == "unusable":
                reason = str(stable_result.report.get("reason") or "stable-ts alignment failed")
                category = str(stable_result.report.get("errorCategory") or "")
                if not category:
                    if reason == "stable-ts is not installed":
                        category = "stable_ts_not_installed"
                    elif reason == "stable-ts failed":
                        category = "stable_ts_alignment_failed"
                    else:
                        category = "caption_timing_unusable"
                raise TranscriptValidationError(f"{category}: {reason}")
            clamped_segments = _mark_segments_realigned(
                clamped_segments,
                provider="stable_ts_forced_align" if pipeline_config.alignment.stableTsEnabled else "whisperx_forced",
            )
            _stage_log("timing_provenance", timing_provenance="realigned")

        try:
            auto_sync_result = apply_auto_sync_if_confident(
                clamped_segments,
                audio_path,
                duration_seconds=vad_report.get("audioDuration"),
                config={
                    "enabled": pipeline_config.autoSync.enabled,
                    "frameStepSeconds": pipeline_config.autoSync.frameStepSeconds,
                    "maxShiftSeconds": pipeline_config.autoSync.maxShiftSeconds,
                    "minScore": pipeline_config.autoSync.minScore,
                    "minImprovement": pipeline_config.autoSync.minImprovement,
                    "maxEstimatedWordRatio": pipeline_config.autoSync.maxEstimatedWordRatio,
                    "allowSkew": pipeline_config.autoSync.allowSkew,
                    "maxSkewDelta": pipeline_config.autoSync.maxSkewDelta,
                },
            )
            clamped_segments = auto_sync_result.segments
        except Exception as exc:
            logger.warning("auto global sync failed safely: %s", exc)
            auto_sync_result = SyncPassResult(clamped_segments, {"applied": False, "reason": str(exc), "warnings": [str(exc)]})

        sync_report = build_sync_report(
            stable_ts=stable_result.report,
            auto_global_sync=auto_sync_result.report,
            manual_sync={"applied": False, "reason": "no manual sync applied during pipeline"},
        )
        sync_report["preRefineAlignmentGroups"] = pre_refine_group_report
        pause_preservation_report: dict[str, int] = {}
        alignment_group_report: dict[str, Any] = {}
        clamped_segments, alignment_group_report = assign_alignment_groups_from_speech_gaps(
            clamped_segments,
            hard_speech_gaps,
            pause_threshold=transcript_aligner.pause_threshold,
        )
        sync_report["alignmentGroups"] = alignment_group_report
        clamped_segments = preserve_detected_pauses(
            clamped_segments,
            hard_speech_gaps,
            pause_threshold=transcript_aligner.pause_threshold,
            diagnostics=pause_preservation_report,
        )
        sync_report["pausePreservation"] = pause_preservation_report
        clamped_segments, word_range_repair_report = sanitize_aligned_word_ranges(clamped_segments)
        sync_report["wordRangeRepair"] = word_range_repair_report
        aligned_words = canonical_aligned_words_from_segments(clamped_segments)
        caption_chunking_rules = _caption_chunking_rules(pipeline_config)
        rebuilt_from_aligned_words = build_segments_from_aligned_words(
            aligned_words,
            chunking_rules=caption_chunking_rules,
        )
        if rebuilt_from_aligned_words:
            clamped_segments = rebuilt_from_aligned_words
            sync_report["captionBuild"] = {
                "sourceOfTruth": "alignedWords",
                "alignedWordCount": len(aligned_words),
                "captionBlockCount": len(clamped_segments),
                "estimatedWordCount": sum(1 for word in aligned_words if word.get("timingNeedsReview") or word.get("timingReviewRequired")),
                "chunkingRules": caption_chunking_rules,
            }
        clamped_segments = annotate_word_timing_sources(clamped_segments)
        aligned_words = canonical_aligned_words_from_segments(clamped_segments)
        _log_caption_timing_debug(
            aligned_words,
            hard_speech_gaps,
            clamped_segments,
            transcript_aligner.pause_threshold,
        )
        timing_report = build_timing_report(clamped_segments, hard_speech_gaps, sync_report)
        debug_segments = [dict(segment, words=[dict(word) for word in segment.get("words") or []]) for segment in clamped_segments]
        debug_aligned_words = [dict(word) for word in aligned_words]
        debug_sync_report = dict(sync_report)
        debug_timing_report = dict(timing_report)
        debug_vad_report = dict(vad_report)

        original_segments = [dict(segment, words=[dict(word) for word in segment.get("words") or []]) for segment in clamped_segments]
        emit_progress("normalizing", 91, "Applying caption output settings.")
        provider_modes = {
            str(chunk.asr_metadata.get("provider_mode") or "")
            for chunk in processed_chunks
            if str(chunk.asr_metadata.get("provider") or "").lower() == "sarvam"
            and chunk.asr_metadata.get("provider_mode")
        }
        provider_output_mode = (
            next(iter(provider_modes)) if len(provider_modes) == 1 else None
        )
        try:
            clamped_segments, transformation_report = transform_segments_for_output(
                clamped_segments,
                source_language=language_mode,
                output_language=output_language,
                provider_mode=provider_output_mode,
            )
        except Exception as exc:
            logger.exception("Caption output transformation failed.")
            raise RuntimeError(f"Caption output transformation failed: {exc}") from exc
        if transformation_report.get("transformation") != "none":
            aligned_words = canonical_aligned_words_from_segments(clamped_segments)
            timing_report = build_timing_report(clamped_segments, hard_speech_gaps, sync_report)
        debug_segments = [dict(segment, words=[dict(word) for word in segment.get("words") or []]) for segment in clamped_segments]
        debug_aligned_words = [dict(word) for word in aligned_words]
        debug_sync_report = dict(sync_report)
        debug_timing_report = dict(timing_report)
        debug_vad_report = dict(vad_report)
        final_quality_report = validate_final_timing_quality(
            clamped_segments,
            pipeline_config=pipeline_config,
            vad_report=vad_report,
            sync_report=sync_report,
            resolved_config_sources=pipeline_config_with_sources.get("sources"),
        )
        sync_report["finalTimingQuality"] = final_quality_report
        timing_report = build_timing_report(clamped_segments, hard_speech_gaps, sync_report)
        timing_report["chunkValidations"] = [
            chunk.asr_metadata.get("timing_validation")
            for chunk in processed_chunks
            if chunk.asr_metadata and chunk.asr_metadata.get("timing_validation")
        ]

        _stage_log("caption chunks generated", segment_count=len(clamped_segments))
        emit_progress("chunking", 92, "Preparing readable caption chunks.")

        emit_progress("rendering", 95, "Generating SRT and VTT exports.")
        # Pass audio_path so the renderer can snap the first caption to the
        # detected speech onset and drop words the provider hallucinated
        # inside pre-speech silence.  The audio file is still on disk at this
        # point; it is removed in the `finally` block below.
        srt_content = generate_srt(clamped_segments, audio_path=audio_path)
        vtt_content = generate_vtt(clamped_segments, audio_path=audio_path)

        offset_us = int(source_in_ms or 0) * 1000 + (
            snapshot_offset_us
            if snapshot_offset_us
            else int(timeline_offset_ms or 0) * 1000
        )
        offset_seconds = offset_us / 1_000_000.0

        if offset_seconds != 0.0:
            logger.info("Applying timeline offset offset_us=%d", offset_us)
            for seg in clamped_segments:
                if "start" in seg:
                    seg["start"] = round(seg["start"] + offset_seconds, 6)
                if "end" in seg:
                    seg["end"] = round(seg["end"] + offset_seconds, 6)
                if "words" in seg:
                    for w in seg["words"]:
                        if "start" in w:
                            w["start"] = round(w["start"] + offset_seconds, 6)
                        if "end" in w:
                            w["end"] = round(w["end"] + offset_seconds, 6)
            for collection in ("speechSegments", "silenceGaps", "hardSpeechGaps"):
                for region in vad_report.get(collection) or []:
                    if region.get("start") is not None:
                        region["start"] = round(float(region["start"]) + offset_seconds, 6)
                    if region.get("end") is not None:
                        region["end"] = round(float(region["end"]) + offset_seconds, 6)
            srt_content = generate_srt(clamped_segments)
            vtt_content = generate_vtt(clamped_segments)

        _stage_log("render completed", segment_count=len(clamped_segments), offset_applied=offset_seconds)

        emit_progress("completed", 100, "Captioning finished successfully.")
        pipeline_logger.end_run()
        log_summary = pipeline_logger.get_summary()
        provider_name = ",".join(sorted(transcription_providers)) or "unknown"
        transcript = build_normalized_transcript(clamped_segments, language_mode, provider_name)
        
        # Calculate overall provenance
        provenances = set()
        for chunk in processed_chunks:
            if chunk.asr_metadata:
                prov = chunk.asr_metadata.get("timing_provenance")
                if prov:
                    provenances.add(prov)
        if not provenances:
            overall_prov = "provider_native"
        elif len(provenances) == 1:
            overall_prov = list(provenances)[0]
        elif "deterministic_estimate" in provenances or "degraded" in provenances:
            overall_prov = "degraded"
        else:
            overall_prov = "mixed"
        
        transcript["timingProvenance"] = overall_prov
        transcript["metadata"] = log_summary
        transcript["metadata"]["timing_provenance"] = overall_prov
        transcript["metadata"]["timingProvenance"] = overall_prov

        if active_snapshot:
            transcript["transcriptionConfiguration"] = active_snapshot.to_dict()
            transcript["provider"] = {
                "name": active_snapshot.provider,
                "model": active_snapshot.model,
                "configurationVersion": active_snapshot.version,
                "timestampStrategy": active_snapshot.timestamp_strategy,
                "providerMode": active_snapshot.provider_mode,
                "strictProvider": active_snapshot.strict_provider,
            }
        transcript["sourceLanguage"] = transformation_report.get("sourceLanguage") or language_mode
        transcript["detectedLanguage"] = transformation_report.get("sourceLanguage") or language_mode
        transcript["outputLanguage"] = transformation_report.get("outputLanguage") or output_language
        transcript["transformation"] = transformation_report.get("transformation") or "none"
        transcript["originalSegments"] = original_segments
        transcript["alignmentRecoveryReport"] = stable_result.report
        if active_snapshot:
            pass
        elif provider_name == "gemini":
            transcript["provider"] = {"name": "gemini", "model": os.getenv("GEMINI_TRANSCRIPTION_MODEL", "gemini-3.5-flash")}
        elif provider_name == "sarvam" and transcription_fallback_from:
            transcript["provider"] = {
                "name": "sarvam",
                "model": "saaras:v3",
                "fallback": True,
                "fallbackFrom": sorted(transcription_fallback_from),
            }
        elif transcription_fallback_from:
            transcript["provider"] = {
                "name": provider_name,
                "fallback": True,
                "fallbackFrom": sorted(transcription_fallback_from),
            }
        transcript["alignedWords"] = aligned_words
        transcript["metadata"] = {
            **log_summary,
            "transcription": {
                "provider": transcript["provider"],
                "fallback": bool(transcription_fallback_from),
                "fallbackFrom": sorted(transcription_fallback_from),
            },
            "output": transformation_report,
            "audio": {
                "sampleRate": 16000,
                "channels": 1,
                "format": "wav",
                "extractedAudioPath": os.path.basename(audio_path),
                "duration": vad_report.get("audioDuration"),
                "origin": audio_origin,
                "timelineOffsetUs": offset_us,
                "timelineDurationUs": timeline_duration_us or None,
            },
            "timing": {
                "configurationAppliedExactly": bool(active_snapshot),
                "resolvedPreset": {
                    "id": active_snapshot.preset_id if active_snapshot else None,
                    "version": active_snapshot.preset_version if active_snapshot else None,
                },
                "resolvedPipelineOptions": pipeline_config.to_dict(),
                "resolvedPipelineOptionSources": pipeline_option_sources,
                "alignment": timing_provider_status,
                "vad": vad_report,
                "report": timing_report,
                "alignmentRecoveryReport": stable_result.report,
                "chunkAudit": chunk_audit[:80],
            },
            "sync": sync_report,
        }
        _stage_log(
            "transcript normalized",
            provider=provider_name,
            segment_count=len(transcript.get("segments") or []),
            timing_sources=timing_report.get("timingSourceCounts"),
            silence_gaps=timing_report.get("silenceGapCount"),
        )

        return {
            "status": "success",
            "languageMode": language_mode,
            "srt": srt_content,
            "vtt": vtt_content,
            "segments": clamped_segments,
            "transcript": transcript,
            "metrics": transcript["metadata"],
            "reviewRequired": job_needs_review,
        }

    except TimingQualityError as e:
        logger.exception("Pipeline final timing quality gate failed.")
        emit_progress("failed", -1, str(e))
        pipeline_logger.end_run(error=str(e))
        quality_report = dict(e.report)
        debug_sync_report = dict(debug_sync_report or {})
        debug_sync_report["finalTimingQuality"] = quality_report
        debug_timing_report = dict(debug_timing_report or {})
        debug_timing_report["qualityFailure"] = quality_report
        debug_transcript = {
            "segments": debug_segments,
            "alignedWords": debug_aligned_words,
            "sourceLanguage": language_mode,
            "detectedLanguage": language_mode,
            "outputLanguage": output_language,
            "transformation": "unknown_after_quality_failure",
            "metadata": {
                "timing": {
                    "configurationAppliedExactly": bool(active_snapshot),
                    "resolvedPreset": {
                        "id": active_snapshot.preset_id if active_snapshot else None,
                        "version": active_snapshot.preset_version if active_snapshot else None,
                    },
                    "resolvedPipelineOptions": pipeline_config.to_dict(),
                    "resolvedPipelineOptionSources": pipeline_option_sources,
                    "vad": debug_vad_report,
                    "report": debug_timing_report,
                },
                "sync": debug_sync_report,
            },
        }
        return {
            "status": "error",
            "code": e.category,
            "message": str(e),
            "languageMode": language_mode,
            "segments": debug_segments,
            "transcript": debug_transcript,
            "metrics": debug_transcript["metadata"],
            "finalTimingQuality": quality_report,
        }
    except TranscriptValidationError as e:
        logger.exception("Pipeline transcript validation failed.")
        emit_progress("failed", -1, str(e))
        pipeline_logger.end_run(error=str(e))
        return {"status": "error", "message": str(e), "languageMode": language_mode}
    except CaptionCueValidationError as e:
        logger.exception("Pipeline caption cue validation failed.")
        emit_progress("failed", -1, str(e))
        pipeline_logger.end_run(error=str(e))
        failure_segments = debug_segments
        failure_aligned_words = debug_aligned_words
        if not failure_segments and isinstance(locals().get("clamped_segments"), list):
            failure_segments = [
                dict(segment, words=[dict(word) for word in segment.get("words") or []])
                for segment in locals()["clamped_segments"]
            ]
        if not failure_aligned_words and isinstance(locals().get("aligned_words"), list):
            failure_aligned_words = [dict(word) for word in locals()["aligned_words"]]
        debug_sync_report = dict(debug_sync_report or {})
        debug_sync_report["captionCueValidation"] = e.report
        debug_timing_report = dict(debug_timing_report or {})
        debug_timing_report["captionCueValidation"] = e.report
        debug_transcript = {
            "segments": failure_segments,
            "alignedWords": failure_aligned_words,
            "sourceLanguage": language_mode,
            "detectedLanguage": language_mode,
            "outputLanguage": output_language,
            "transformation": "unknown_after_caption_cue_failure",
            "metadata": {
                "timing": {
                    "configurationAppliedExactly": bool(active_snapshot),
                    "resolvedPreset": {
                        "id": active_snapshot.preset_id if active_snapshot else None,
                        "version": active_snapshot.preset_version if active_snapshot else None,
                    },
                    "resolvedPipelineOptions": pipeline_config.to_dict(),
                    "resolvedPipelineOptionSources": pipeline_option_sources,
                    "vad": debug_vad_report,
                    "report": debug_timing_report,
                },
                "sync": debug_sync_report,
            },
        }
        return {
            "status": "error",
            "code": e.code,
            "message": str(e),
            "languageMode": language_mode,
            "segments": failure_segments,
            "transcript": debug_transcript,
            "metrics": debug_transcript["metadata"],
            "captionCueValidation": e.report,
        }
    except Exception as e:
        logger.exception("Pipeline failed critically.")
        emit_progress("failed", -1, str(e))
        pipeline_logger.end_run(error=str(e))
        return {"status": "error", "message": str(e), "languageMode": language_mode}
    finally:
        if os.path.exists(audio_path):
            os.remove(audio_path)

        for c in chunks:
            if os.path.exists(c.audio_path):
                os.remove(c.audio_path)
        _stage_log("temp cleanup completed", video_path=video_path)
