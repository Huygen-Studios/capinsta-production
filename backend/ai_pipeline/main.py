import logging
import os
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
from .timing import (
    alignment_provider_status,
    annotate_word_timing_sources,
    build_timing_report,
    detect_silence_gaps,
)
from .transcriber import transcribe_audio
from .language_modes import CODE_MIXED_LANGUAGE_MODES, normalize_caption_text, normalize_language_mode
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


def run_pipeline(
    video_path: str,
    user_target_lang: str = "english",
    progress_callback=None,
) -> Dict[str, Any]:
    """Run transcription, normalization, alignment, and subtitle export."""
    language_mode = normalize_language_mode(user_target_lang)
    pipeline_logger = PipelineLogger(os.path.basename(video_path))
    pipeline_logger.start_run()
    audio_path = f"{os.path.splitext(video_path)[0]}_temp.wav"
    chunks = []
    transcription_providers: set[str] = set()

    def emit_progress(status: str, percent: int, details: str = ""):
        logger.info(f"Progress: {percent}% - {status} - {details}")
        if progress_callback:
            progress_callback(status, percent, details)

    try:
        _stage_log("audio extraction started", video_path=video_path, language_mode=language_mode)
        emit_progress("extracting_audio", 5, "Extracting audio from uploaded video.")
        extract_audio(video_path, audio_path)
        _stage_log("audio extraction completed", audio_path=audio_path, language_mode=language_mode)

        emit_progress("normalizing", 10, "Estimating audio quality.")
        metrics = measure_audio_quality(audio_path)
        timing_provider_status = alignment_provider_status()
        transcript_aligner = TranscriptAligner()
        timing_provider_status["transcriptAligner"] = transcript_aligner.status()
        vad_report = detect_silence_gaps(audio_path, min_silence=transcript_aligner.pause_threshold)
        adaptive_thresholds_dict = adaptive_thresholds(metrics["snr_db"], metrics["speech_rate"])
        logger.info(f"Adaptive Thresholds Applied: {adaptive_thresholds_dict}")

        emit_progress("normalizing", 15, "Chunking audio for transcription.")
        is_strict = metrics["snr_db"] < 10.0
        chunks = overlap_chunk(audio_path, mode="strict" if is_strict else "normal")
        total_chunks = max(len(chunks), 1)
        processed_chunks = []

        emit_progress("transcribing", 18, f"Transcribing {len(chunks)} audio chunk(s).")
        _stage_log("transcription started", chunk_count=len(chunks), language_mode=language_mode)

        for i, chunk in enumerate(chunks):
            chunk_pct = 18 + int((i / total_chunks) * 48)
            emit_progress("transcribing", chunk_pct, f"Processing chunk {i + 1}/{len(chunks)}.")
            apply_fade(chunk.audio_path)

            transcription_result = transcribe_audio(chunk.audio_path, language_mode=language_mode)
            transcription_providers.add(str(transcription_result.get("provider") or "unknown"))
            raw_text = transcription_result.get("text", "")
            clean_text = normalize_caption_text(raw_text, language_mode)
            chunk.raw_text = clean_text
            chunk.asr_metadata = transcription_result
            score = float(transcription_result.get("language_probability") or 1.0)

            if not clean_text.strip():
                processed_chunks.append(chunk)
                continue

            if language_mode in CODE_MIXED_LANGUAGE_MODES:
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
        if language_mode in CODE_MIXED_LANGUAGE_MODES:
            clamped_segments = build_word_timed_transcript_from_chunks(
                processed_chunks,
                language_mode,
                speech_segments=vad_report.get("speechSegments") or [],
                chunk_audit=chunk_audit,
            )
        else:
            merged_text, merged_segments = merge_chunks(processed_chunks)
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
                aligned_segments = align_text(prompt_segments_with_time, audio_path, MODEL_ALIGN_EN)
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

            clamped_segments = normalize_aligned_segments(clamped_segments, language_mode)

        emit_progress("normalizing", 88, "Optimizing word-level timestamps.")
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
            stable_result = apply_stable_refinement(clamped_segments, audio_path, language_mode)
            clamped_segments = stable_result.segments
        except Exception as exc:
            logger.warning("stable-ts sync refinement failed safely: %s", exc)
            stable_result = SyncPassResult(clamped_segments, {"applied": False, "reason": str(exc), "warnings": [str(exc)]})

        try:
            auto_sync_result = apply_auto_sync_if_confident(
                clamped_segments,
                audio_path,
                duration_seconds=vad_report.get("audioDuration"),
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
        aligned_words = canonical_aligned_words_from_segments(clamped_segments)
        rebuilt_from_aligned_words = build_segments_from_aligned_words(aligned_words)
        if rebuilt_from_aligned_words:
            clamped_segments = rebuilt_from_aligned_words
            sync_report["captionBuild"] = {
                "sourceOfTruth": "alignedWords",
                "alignedWordCount": len(aligned_words),
                "captionBlockCount": len(clamped_segments),
                "estimatedWordCount": sum(1 for word in aligned_words if word.get("timingNeedsReview") or word.get("timingReviewRequired")),
            }
        clamped_segments = annotate_word_timing_sources(clamped_segments)
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
        transcript["alignedWords"] = aligned_words
        transcript["metadata"] = {
            **log_summary,
            "audio": {
                "sampleRate": 16000,
                "channels": 1,
                "format": "wav",
                "extractedAudioPath": os.path.basename(audio_path),
                "duration": vad_report.get("audioDuration"),
            },
            "timing": {
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
