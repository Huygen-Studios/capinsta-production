import json
from collections import Counter
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query

from ..database import get_db
from ..auth import get_owned_job
from ai_pipeline.sync.aligned_words import aligned_word_quality, canonical_aligned_words_from_segments
from ai_pipeline.sync.high_quality import high_quality_alignment_status
from ai_pipeline.pipeline_config import resolve_pipeline_config_with_sources
from ai_pipeline.timing import DEFAULT_PAUSE_SPLIT_THRESHOLD, build_timing_report, classify_caption_gaps, normalize_timing_source

router = APIRouter(prefix="/captions/jobs", tags=["captions"])


def _load_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return fallback


def _caption_chunks_from_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    for segment in segments:
        words = segment.get("words") or []
        chunks.append({
            "start": segment.get("start"),
            "end": segment.get("end"),
            "text": segment.get("text", ""),
            "wordCount": len(words),
        })
    return chunks


def _words_around_time(words: list[dict[str, Any]], current_time: float | None, limit: int = 100) -> list[dict[str, Any]]:
    if current_time is None or not words:
        return words[:limit]
    best_index = 0
    best_distance = float("inf")
    for index, word in enumerate(words):
        try:
            start = float(word.get("start") or 0.0)
            end = float(word.get("end") or start)
        except (TypeError, ValueError):
            continue
        distance = 0.0 if start <= current_time <= end else min(abs(current_time - start), abs(current_time - end))
        if distance < best_distance:
            best_distance = distance
            best_index = index
    half = max(1, limit // 2)
    start_index = max(0, min(best_index - half, max(0, len(words) - limit)))
    return words[start_index:start_index + limit]


@router.get("/{job_id}/timing-debug")
async def timing_debug(
    job_id: str,
    current_time: float | None = Query(None, alias="currentTime"),
    db: aiosqlite.Connection = Depends(get_db),
):
    row = await get_owned_job(db, job_id)

    transcript = _load_json(row["transcript_json"] if "transcript_json" in row.keys() else None, None)
    segments = []
    metadata: dict[str, Any] = {}
    if transcript:
        segments = transcript.get("segments") or []
        metadata = transcript.get("metadata") or {}
    if not segments:
        segments = _load_json(row["segments_json"], [])

    words: list[dict[str, Any]] = []
    source_counts: Counter[str] = Counter()
    for segment in segments:
        for word in segment.get("words") or []:
            source = normalize_timing_source(word.get("timingSource") or word.get("timing_source"), word.get("provider"))
            source_counts[source] += 1
            words.append({
                "word": word.get("displayedWord") or word.get("word") or word.get("originalWord"),
                "displayWord": word.get("displayedWord") or word.get("word"),
                "spokenWord": word.get("spokenWord") or word.get("originalWord") or word.get("word"),
                "start": word.get("start"),
                "end": word.get("end"),
                "timingSource": source,
                "alignmentGroupId": word.get("alignmentGroupId") or segment.get("alignmentGroupId"),
                "sourceSegmentIndex": word.get("sourceSegmentIndex"),
                "sourceChunkIndex": word.get("sourceChunkIndex"),
                "sourceStart": word.get("sourceStart"),
                "sourceEnd": word.get("sourceEnd"),
                "speakerId": word.get("speakerId"),
                "turnId": word.get("turnId"),
                "captionBlockId": segment.get("id"),
                "timingNeedsReview": bool(word.get("timingNeedsReview") or word.get("timingReviewRequired")),
                "confidence": word.get("confidence", word.get("score")),
            })
    group_summary: dict[str, dict[str, Any]] = {}
    for word in words:
        group_id = str(word.get("alignmentGroupId") or "unknown")
        group = group_summary.setdefault(group_id, {"wordCount": 0, "timingSources": Counter(), "needsReview": 0})
        group["wordCount"] += 1
        group["timingSources"][word.get("timingSource") or "unknown"] += 1
        if word.get("timingNeedsReview"):
            group["needsReview"] += 1

    timing_meta = metadata.get("timing") if isinstance(metadata.get("timing"), dict) else {}
    configuration_snapshot = transcript.get("transcriptionConfiguration") if isinstance(transcript, dict) else None
    resolved_pipeline_options = (
        timing_meta.get("resolvedPipelineOptions")
        or (configuration_snapshot or {}).get("resolved_pipeline_options")
        or (configuration_snapshot or {}).get("pipeline_options")
        or {}
    )
    vad = timing_meta.get("vad") if isinstance(timing_meta.get("vad"), dict) else {}
    silence_gaps = vad.get("silenceGaps") if isinstance(vad.get("silenceGaps"), list) else []
    chunk_audit = timing_meta.get("chunkAudit") if isinstance(timing_meta.get("chunkAudit"), list) else []
    sync_meta = metadata.get("sync") if isinstance(metadata.get("sync"), dict) else {}
    report = timing_meta.get("report") if isinstance(timing_meta.get("report"), dict) else build_timing_report(segments, silence_gaps, sync_meta)
    aligned_words = transcript.get("alignedWords") if isinstance(transcript, dict) and isinstance(transcript.get("alignedWords"), list) else canonical_aligned_words_from_segments(segments)
    speech_segments = vad.get("speechSegments", []) if isinstance(vad.get("speechSegments"), list) else []
    quality = aligned_word_quality(segments)
    resolved_with_sources = resolve_pipeline_config_with_sources(
        resolved_pipeline_options if isinstance(resolved_pipeline_options, dict) else {}
    )
    saved_source_map = (
        (configuration_snapshot or {}).get("pipeline_option_sources")
        or (configuration_snapshot or {}).get("pipelineOptionSources")
        or {}
    )

    return {
        "jobId": job_id,
        "status": row["status"],
        "wordCount": len(words),
        "chunkCount": len(segments),
        "timingSourceCounts": dict(source_counts) or report.get("timingSourceCounts", {}),
        "silenceGaps": silence_gaps,
        "speechSegments": vad.get("speechSegments", [])[:80] if isinstance(vad.get("speechSegments"), list) else [],
        "chunkAudit": chunk_audit[:80],
        "suspiciousTimingWarnings": report.get("warnings", []),
        "syncReport": sync_meta,
        "autoSyncApplied": report.get("autoSyncApplied", False),
        "autoSyncQuality": report.get("autoSyncQuality", 0),
        "autoSyncImprovement": report.get("autoSyncImprovement", 0),
        "stableTsCoverage": report.get("stableTsCoverage", 0),
        "stableTsMatchesAccepted": (sync_meta.get("stableTs") or {}).get("appliedWords", report.get("stableTsAppliedWords", 0)) if isinstance(sync_meta, dict) else report.get("stableTsAppliedWords", 0),
        "stableTsBoundaryRejected": (sync_meta.get("stableTs") or {}).get("boundaryRejectedWords", 0) if isinstance(sync_meta, dict) else 0,
        "stableTsOrderFallbackEnabled": bool(((resolved_with_sources.get("resolved") or {}).get("alignment") or {}).get("allowStableTsOrderFallback")),
        "speechActivityRanges": report.get("speechActivityRanges", []),
        "captionActivityRanges": report.get("captionActivityRanges", []),
        "chunks": _caption_chunks_from_segments(segments)[:200],
        "first20Words": words[:20],
        "first50AlignedWords": words[:50],
        "first100AlignedWordsAroundCurrentTime": _words_around_time(words, current_time, 100),
        "captionTimingBasis": (sync_meta.get("captionBuild") or {}).get("sourceOfTruth") if isinstance(sync_meta, dict) else "unknown",
        "alignedWordCount": len(aligned_words),
        "estimatedWordCount": quality.get("estimatedWordCount", report.get("estimatedWordCount", 0)),
        "estimatedWordRatio": quality.get("estimatedWordRatio", 0),
        "timingNeedsReviewCount": quality.get("timingNeedsReviewCount", 0),
        "highQualityAlignmentLastRun": (sync_meta.get("highQualityAlignment") or {}).get("lastRun") if isinstance(sync_meta, dict) else None,
        **high_quality_alignment_status(),
        "autoSyncRejectReason": (sync_meta.get("autoGlobalSync") or {}).get("rejectReason") if isinstance(sync_meta, dict) else None,
        "captionGaps": classify_caption_gaps(segments, speech_segments),
        "pauseThresholdUsed": vad.get("thresholdSeconds") or DEFAULT_PAUSE_SPLIT_THRESHOLD,
        "configurationSnapshot": configuration_snapshot,
        "resolvedPipelineOptions": resolved_with_sources.get("resolved") or resolved_pipeline_options,
        "resolvedPipelineOptionSources": saved_source_map if isinstance(saved_source_map, dict) and saved_source_map else (resolved_with_sources.get("sources") or {}),
        "resolvedPreset": {
            "id": (configuration_snapshot or {}).get("preset_id") or (configuration_snapshot or {}).get("presetId"),
            "version": (configuration_snapshot or {}).get("preset_version") or (configuration_snapshot or {}).get("presetVersion"),
        },
        "alignmentGroupSummary": {
            group_id: {
                **{key: value for key, value in group.items() if key != "timingSources"},
                "timingSources": dict(group["timingSources"]),
            }
            for group_id, group in group_summary.items()
        },
        "configurationAppliedExactly": bool(timing_meta.get("configurationAppliedExactly")),
        "report": report,
    }
