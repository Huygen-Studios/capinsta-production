from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

try:
    from contracts.transcript_document_v2 import (
        Provider,
        Quality,
        Segment,
        Speaker,
        TranscriptDocumentV2,
        Word,
    )
except ImportError:  # Repository-root test execution.
    from backend.contracts.transcript_document_v2 import (
        Provider,
        Quality,
        Segment,
        Speaker,
        TranscriptDocumentV2,
        Word,
    )


def _ms(value: Any) -> int | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return round(number * 1000)


def _timing_source(value: Any) -> str:
    source = str(value or "").lower()
    if "manual" in source:
        return "manuallyAdjusted"
    if "align" in source or "forced" in source or "repair" in source:
        return "aligned"
    if "interpol" in source:
        return "interpolated"
    if any(
        marker in source
        for marker in (
            "estimated",
            "synthetic",
            "fallback",
            "structured",
            "segment_derived",
            "provider_phrase",
        )
    ):
        return "estimated"
    if "provider" in source or "native" in source:
        return "provider"
    return "unknown"


def _bounded_time(
    value: int | None,
    *,
    duration_ms: int,
    warnings: set[str],
    nullable: bool,
) -> int | None:
    if value is None:
        return None if nullable else 0
    if value < 0:
        raise ValueError("negative provider timestamp")
    if value <= duration_ms:
        return value
    if value - duration_ms <= 50:
        warnings.add("duration_mismatch_clamped")
        return duration_ms
    raise ValueError("provider timestamp exceeds media duration")


def _confidence(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not 0 <= number <= 1:
        raise ValueError("provider confidence is outside 0..1")
    return number


def _detected_languages(transcript: dict[str, Any]) -> list[str]:
    result: list[str] = []
    for raw in (
        transcript.get("detectedLanguage"),
        transcript.get("sourceLanguage"),
    ):
        value = str(raw or "").strip()
        if value and value not in result:
            result.append(value)
    return result


def build_transcript_document_v2(
    transcript: dict[str, Any],
    *,
    transcript_id: str,
    media_id: str,
    duration_ms: int,
    language_mode: str,
    provider_name: str,
    provider_model: str,
    configuration_snapshot: dict[str, Any],
    created_at: datetime,
    updated_at: datetime | None = None,
) -> tuple[TranscriptDocumentV2, list[str]]:
    warnings: set[str] = set()
    raw_segments = transcript.get("segments") or []
    if not isinstance(raw_segments, list):
        raise ValueError("normalized transcript segments must be a list")
    original_segments = transcript.get("originalSegments") or []
    if not isinstance(original_segments, list):
        original_segments = []

    words: list[Word] = []
    segments: list[Segment] = []
    speaker_labels: dict[str, str] = {}
    low_confidence_count = 0
    untimed_count = 0

    for segment_index, raw in enumerate(raw_segments, 1):
        if not isinstance(raw, dict):
            raise ValueError("normalized transcript segment is invalid")
        segment_id = str(raw.get("id") or f"seg_{segment_index:06d}")
        raw_words = raw.get("words") or []
        if not isinstance(raw_words, list):
            raise ValueError("normalized transcript words must be a list")
        word_ids: list[str] = []
        original_segment = (
            original_segments[segment_index - 1]
            if segment_index <= len(original_segments)
            and isinstance(original_segments[segment_index - 1], dict)
            else {}
        )
        segment_speaker = raw.get("speakerId")
        if segment_speaker:
            speaker_id = str(segment_speaker)
            speaker_labels[speaker_id] = str(
                raw.get("speakerLabel") or speaker_id
            )
        for raw_word in raw_words:
            if not isinstance(raw_word, dict):
                raise ValueError("normalized transcript word is invalid")
            word_id = str(
                raw_word.get("id") or f"word_{len(words) + 1:06d}"
            )
            word_ids.append(word_id)
            start_ms = _bounded_time(
                _ms(raw_word.get("start")),
                duration_ms=duration_ms,
                warnings=warnings,
                nullable=True,
            )
            end_ms = _bounded_time(
                _ms(raw_word.get("end")),
                duration_ms=duration_ms,
                warnings=warnings,
                nullable=True,
            )
            if (start_ms is None) != (end_ms is None):
                start_ms = None
                end_ms = None
                warnings.add("word_timing_missing")
            if start_ms is None:
                untimed_count += 1
                warnings.add("untimed_word_preserved")
            confidence = _confidence(raw_word.get("confidence"))
            if confidence is None:
                warnings.add("confidence_missing")
            is_low_confidence = bool(
                raw_word.get("isLowConfidence")
                or (confidence is not None and confidence < 0.5)
            )
            if is_low_confidence:
                low_confidence_count += 1
            displayed = str(
                raw_word.get("displayedWord")
                or raw_word.get("word")
                or raw_word.get("text")
                or ""
            )
            original = raw_word.get("originalWord") or raw_word.get(
                "spokenWord"
            )
            if original is not None and str(original) != displayed:
                warnings.add("provider_text_normalized")
            speaker_id = (
                str(raw_word["speakerId"])
                if raw_word.get("speakerId")
                else (
                    str(segment_speaker) if segment_speaker is not None else None
                )
            )
            if speaker_id:
                speaker_labels[speaker_id] = str(
                    raw_word.get("speakerLabel")
                    or speaker_labels.get(speaker_id)
                    or speaker_id
                )
            raw_timing_source = raw_word.get(
                "timingSource"
            ) or raw_word.get("timing_source")
            timing_source = _timing_source(raw_timing_source)
            if "repair" in str(raw_timing_source or "").lower():
                warnings.add("word_timing_repaired")
            words.append(
                Word(
                    id=word_id,
                    segmentId=segment_id,
                    text=displayed,
                    originalText=str(original) if original is not None else None,
                    startMs=start_ms,
                    endMs=end_ms,
                    confidence=confidence,
                    speakerId=speaker_id,
                    language=raw_word.get("languageHint")
                    or raw_word.get("language"),
                    timingSource=timing_source,
                    isFiller=bool(raw_word.get("isFiller", False)),
                    isLowConfidence=is_low_confidence,
                    metadata={
                        key: raw_word[key]
                        for key in (
                            "normalizationRule",
                            "scriptHint",
                            "timingNeedsReview",
                            "timing_repair",
                        )
                        if raw_word.get(key) is not None
                    },
                )
            )

        start_ms = _bounded_time(
            _ms(raw.get("start")),
            duration_ms=duration_ms,
            warnings=warnings,
            nullable=False,
        )
        end_ms = _bounded_time(
            _ms(raw.get("end")),
            duration_ms=duration_ms,
            warnings=warnings,
            nullable=False,
        )
        displayed_text = str(raw.get("text") or "")
        original_text = raw.get("originalText") or original_segment.get("text")
        if original_text is not None and str(original_text) != displayed_text:
            warnings.add("provider_text_normalized")
        segments.append(
            Segment(
                id=segment_id,
                startMs=int(start_ms or 0),
                endMs=int(end_ms or 0),
                text=displayed_text,
                originalText=(
                    str(original_text) if original_text is not None else None
                ),
                speakerId=(
                    str(segment_speaker)
                    if segment_speaker is not None
                    else None
                ),
                language=raw.get("language"),
                confidence=_confidence(raw.get("confidence")),
                wordIds=word_ids,
                timingSource=_timing_source(
                    raw.get("timingSource")
                    or raw.get("timing_source")
                    or transcript.get("timingProvenance")
                ),
                metadata={
                    key: raw[key]
                    for key in ("timingNeedsReview",)
                    if raw.get(key) is not None
                },
            )
        )

    overlap_count = 0
    for previous, current in zip(segments, segments[1:]):
        if current.startMs < previous.endMs:
            overlap_count += 1
    if overlap_count:
        warnings.add("overlapping_segments_preserved")
    if language_mode in {"auto", "auto_mixed_indian"} and _detected_languages(
        transcript
    ):
        warnings.add("language_auto_detected")
    provider_payload = transcript.get("provider")
    provider_request_id = (
        provider_payload.get("requestId")
        if isinstance(provider_payload, dict)
        else None
    )
    if isinstance(provider_payload, dict) and provider_payload.get("fallback"):
        warnings.add("provider_fallback_used")

    timing_sources = {
        word.timingSource for word in words if word.timingSource != "unknown"
    } or {segment.timingSource for segment in segments}
    now = updated_at or datetime.now(timezone.utc)
    document = TranscriptDocumentV2(
        transcriptId=transcript_id,
        mediaId=media_id,
        durationMs=duration_ms,
        languageMode=language_mode,
        detectedLanguages=_detected_languages(transcript),
        provider=Provider(
            name=provider_name,
            model=provider_model,
            requestId=(
                str(provider_request_id)
                if provider_request_id is not None
                else None
            ),
            metadata={
                "configurationId": configuration_snapshot.get(
                    "configuration_id"
                ),
                "configurationVersion": configuration_snapshot.get("version"),
                "timestampStrategy": configuration_snapshot.get(
                    "timestamp_strategy"
                ),
            },
        ),
        segments=segments,
        words=words,
        speakers=[
            Speaker(id=speaker_id, label=label)
            for speaker_id, label in sorted(speaker_labels.items())
        ],
        silenceRegions=[],
        quality=Quality(
            lowConfidenceWordCount=low_confidence_count,
            untimedWordCount=untimed_count,
            overlapCount=overlap_count,
            warnings=sorted(warnings),
        ),
        metadata={
            "romanized": bool(transcript.get("romanized")),
            "outputLanguage": transcript.get("outputLanguage"),
            "transformation": transcript.get("transformation") or "none",
            "timingProvenance": transcript.get("timingProvenance")
            or "unknown",
        },
        createdAt=created_at,
        updatedAt=now,
    )
    document = TranscriptDocumentV2.model_validate(
        document.model_dump(mode="json")
    )
    return document, sorted(warnings)


def summarize_timing_source(document: TranscriptDocumentV2) -> str:
    sources = {
        word.timingSource for word in document.words
    } or {segment.timingSource for segment in document.segments}
    sources.discard("unknown")
    if not sources:
        return "unknown"
    if len(sources) == 1:
        return next(iter(sources))
    return "mixed"


__all__ = [
    "build_transcript_document_v2",
    "summarize_timing_source",
]
