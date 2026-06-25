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
from .renderer import generate_srt, generate_vtt
from .sentence_splitter import split_sentences_v2
from .sync.aligned_words import build_segments_from_aligned_words, canonical_aligned_words_from_segments
from .sync.auto_sync import apply_auto_sync_if_confident
from .sync.report import SyncPassResult, build_sync_report
from .sync.stable_refine import apply_stable_refinement
from .sync.pause_preserver import preserve_detected_pauses
from .pipeline_config import resolve_pipeline_config
from .timing import (
    alignment_provider_status,
    annotate_word_timing_sources,
    build_timing_report,
    detect_silence_gaps,
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
                        "text": chunk.get("text"),
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
        "caption_timing_debug alignedWordsFirst50=%r",
        [
            {
                "word": word.get("displayedWord") or word.get("word"),
                "start": word.get("start"),
                "end": word.get("end"),
                "timing_source": word.get("timingSourceDetail")
                or word.get("timing_source")
                or word.get("timingSource"),
            }
            for word in aligned_words[:50]
        ],
    )


def _chunks_have_provider_words(chunks: list[Any]) -> bool:
    text_chunks = [chunk for chunk in chunks if str(getattr(chunk, "final_text", "") or getattr(chunk, "raw_text", "") or "").strip()]
    if not text_chunks:
        return False
    for chunk in text_chunks:
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
            word["timingProvenance"] = "realigned"
            word["timingSourceDetail"] = detailed_source
            word["timingSource"] = detailed_source
            word["timing_source"] = detailed_source
            word["timingSourceCategory"] = "realigned"
    return segments


def run_pipeline(
    video_path: str,
    user_target_lang: str = "english",
    caption_output: str = "original",
    transcription_config_snapshot: dict[str, Any] | None = None,
    progress_callback=None,
) -> Dict[str, Any]:
    """Run transcription, normalization, alignment, and subtitle export."""
    language_mode = normalize_language_mode(user_target_lang)
    output_language = normalize_caption_output(caption_output)
    pipeline_logger = PipelineLogger(os.path.basename(video_path))
    pipeline_logger.start_run()
    audio_path = f"{os.path.splitext(video_path)[0]}_temp.mp3"
    chunks = []
    transcription_providers: set[str] = set()
    transcription_fallback_from: set[str] = set()
    active_snapshot = coerce_snapshot(transcription_config_snapshot)
    pipeline_config = resolve_pipeline_config(active_snapshot.resolved_pipeline_options if active_snapshot else None)

    def emit_progress(status: str, percent: int, details: str = ""):
        logger.info(f"Progress: {percent}% - {status} - {details}")
        if progress_callback:
            progress_callback(status, percent, details)

    try:
        _stage_log("audio extraction started", video_path=video_path, language_mode=language_mode)
        emit_progress("extracting_audio", 5, "Extracting audio from uploaded video.")
        audio_options = pipeline_config.audio
        ffmpeg_codec = "pcm_s16le" if audio_options.codec == "pcm_s16le" else "libmp3lame"
        if audio_options.codec == "pcm_s16le":
            audio_path = f"{os.path.splitext(video_path)[0]}_temp.wav"
        extract_audio(
            video_path,
            audio_path,
            sample_rate=audio_options.sampleRate,
            channels=audio_options.channels,
            codec=ffmpeg_codec,
            bitrate_kbps=audio_options.bitrateKbps,
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
        )
        adaptive_thresholds_dict = adaptive_thresholds(metrics["snr_db"], metrics["speech_rate"])
        logger.info(f"Adaptive Thresholds Applied: {adaptive_thresholds_dict}")

        emit_progress("normalizing", 15, "Chunking audio for transcription.")
        is_strict = metrics["snr_db"] < 10.0
        chunking_options = pipeline_config.audioChunking
        chunks = overlap_chunk(
            audio_path,
            mode="strict" if is_strict else "normal",
            speech_segments=vad_report.get("speechSegments") or [],
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
            transcription_providers.add(str(transcription_result.get("provider") or "unknown"))
            if transcription_result.get("fallback") and transcription_result.get("fallback_from"):
                fallback_from = transcription_result.get("fallback_from")
                if isinstance(fallback_from, list):
                    transcription_fallback_from.update(str(provider) for provider in fallback_from)
                else:
                    transcription_fallback_from.add(str(fallback_from))
            raw_text = transcription_result.get("text", "")
            clean_text = normalize_caption_text(raw_text, language_mode)
            chunk.raw_text = clean_text
            chunk.asr_metadata = {
                **transcription_result,
                "providerRawText": transcription_result.get("providerRawText") or raw_text,
                "normalizedText": clean_text,
                "displayText": clean_text,
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
        emit_progress("romanizing", 70, "Romanizing and validating transcript text.")

        chunk_audit: list[dict[str, Any]] = []
        has_provider_word_timing = _chunks_have_provider_words(processed_chunks)
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
        if pipeline_config.timingSourcePolicy == "native_required" and not has_provider_word_timing:
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

            for seg in merged_segments:
                seg_sents = split_sentences_v2(seg["text"], strict=is_strict)
                if not seg_sents:
                    continue

                word_counts = [max(len(s.split()), 1) for s in seg_sents]
                total_words = sum(word_counts)
                seg_total_dur = seg["end"] - seg["start"]
                cursor = seg["start"]

                for sent_index, sent in enumerate(seg_sents):
                    frac = word_counts[sent_index] / total_words
                    sent_dur = seg_total_dur * frac
                    sent_start = round(cursor, 3)
                    sent_end = round(cursor + sent_dur, 3)
                    prompt_segments_with_time.append(
                        {"text": sent, "start": sent_start, "end": sent_end}
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

        emit_progress("normalizing", 89, "Running caption sync engine.")
        try:
            if pipeline_config.alignment.stableTsEnabled:
                _stage_log("stable_ts_model_loading", model=pipeline_config.alignment.stableTsModel)
            stable_result = apply_stable_refinement(
                clamped_segments,
                audio_path,
                language_mode,
                config={
                    "enabled": pipeline_config.alignment.stableTsEnabled,
                    "model": pipeline_config.alignment.stableTsModel,
                    "device": pipeline_config.alignment.stableTsDevice,
                    "minMatchCoverage": pipeline_config.alignment.stableTsMinMatchCoverage,
                    "minWordRatio": pipeline_config.alignment.stableTsMinWordRatio,
                    "maxWordRatio": pipeline_config.alignment.stableTsMaxWordRatio,
                    "allowOrderFallback": pipeline_config.alignment.allowStableTsOrderFallback,
                },
            )
            clamped_segments = stable_result.segments
            if pipeline_config.alignment.stableTsEnabled:
                _stage_log(
                    "stable_ts_alignment_completed",
                    applied=stable_result.report.get("applied"),
                    reason=stable_result.report.get("reason"),
                )
        except Exception as exc:
            logger.warning("stable-ts sync refinement failed safely: %s", exc)
            stable_result = SyncPassResult(clamped_segments, {"applied": False, "reason": str(exc), "warnings": [str(exc)]})
        if alignment_was_forced:
            if pipeline_config.alignment.stableTsEnabled and not stable_result.report.get("applied"):
                reason = str(stable_result.report.get("reason") or "stable-ts alignment failed")
                category = str(stable_result.report.get("errorCategory") or "")
                if not category:
                    if reason == "stable-ts is not installed":
                        category = "stable_ts_not_installed"
                    elif reason == "stable-ts failed":
                        category = "stable_ts_alignment_failed"
                    else:
                        category = "alignment_coverage_too_low"
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
        pause_preservation_report: dict[str, int] = {}
        clamped_segments = preserve_detected_pauses(
            clamped_segments,
            vad_report.get("silenceGaps") or [],
            pause_threshold=transcript_aligner.pause_threshold,
            diagnostics=pause_preservation_report,
        )
        sync_report["pausePreservation"] = pause_preservation_report
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
            vad_report.get("silenceGaps") or [],
            clamped_segments,
            transcript_aligner.pause_threshold,
        )
        timing_report = build_timing_report(clamped_segments, vad_report.get("silenceGaps") or [], sync_report)

        original_segments = [dict(segment, words=[dict(word) for word in segment.get("words") or []]) for segment in clamped_segments]
        emit_progress("normalizing", 91, "Applying caption output settings.")
        try:
            clamped_segments, transformation_report = transform_segments_for_output(
                clamped_segments,
                source_language=language_mode,
                output_language=output_language,
            )
        except Exception as exc:
            logger.exception("Caption output transformation failed.")
            raise RuntimeError(f"Caption output transformation failed: {exc}") from exc
        if transformation_report.get("transformation") != "none":
            aligned_words = canonical_aligned_words_from_segments(clamped_segments)
            timing_report = build_timing_report(clamped_segments, vad_report.get("silenceGaps") or [], sync_report)

        _stage_log("caption chunks generated", segment_count=len(clamped_segments))
        emit_progress("chunking", 92, "Preparing readable caption chunks.")

        emit_progress("rendering", 95, "Generating SRT and VTT exports.")
        # Pass audio_path so the renderer can snap the first caption to the
        # detected speech onset and drop words the provider hallucinated
        # inside pre-speech silence.  The audio file is still on disk at this
        # point; it is removed in the `finally` block below.
        srt_content = generate_srt(clamped_segments, audio_path=audio_path)
        vtt_content = generate_vtt(clamped_segments, audio_path=audio_path)
        _stage_log("render completed", segment_count=len(clamped_segments))

        emit_progress("completed", 100, "Captioning finished successfully.")
        pipeline_logger.end_run()
        log_summary = pipeline_logger.get_summary()
        provider_name = ",".join(sorted(transcription_providers)) or "unknown"
        transcript = build_normalized_transcript(clamped_segments, language_mode, provider_name)
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
                "sampleRate": audio_options.sampleRate,
                "channels": audio_options.channels,
                "format": "wav" if audio_options.codec == "pcm_s16le" else "mp3",
                "extractedAudioPath": os.path.basename(audio_path),
                "duration": vad_report.get("audioDuration"),
            },
            "timing": {
                "configurationAppliedExactly": bool(active_snapshot),
                "resolvedPipelineOptions": pipeline_config.to_dict(),
                "alignment": timing_provider_status,
                "vad": vad_report,
                "report": timing_report,
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
        }

    except TranscriptValidationError as e:
        logger.exception("Pipeline transcript validation failed.")
        emit_progress("failed", -1, str(e))
        pipeline_logger.end_run(error=str(e))
        return {"status": "error", "message": str(e), "languageMode": language_mode}
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
