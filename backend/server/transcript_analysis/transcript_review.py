from __future__ import annotations

import re
from typing import Iterable

try:
    from contracts.transcript_document_v2 import TranscriptDocumentV2, Word
except ImportError:
    from backend.contracts.transcript_document_v2 import (
        TranscriptDocumentV2,
        Word,
    )

from .contracts import (
    ProposedActionV1,
    TimelineRecommendationV1,
    TranscriptAnalysisDocumentV1,
    TranscriptAnalysisSummaryV1,
    TranscriptFindingV1,
)
from .identity import stable_id

_EDGE_PUNCTUATION = re.compile(r"^[^\w\u0900-\u097f]+|[^\w\u0900-\u097f]+$")
_FILLERS = {
    "english": frozenset({"um", "uh", "er", "ah"}),
    "hindi": frozenset({"tum", "ha"}),
    "hinglish": frozenset({"um", "uh", "er", "ah", "tum", "ha"}),
    "auto_mixed_indian": frozenset(
        {"um", "uh", "er", "ah", "tum", "ha"}
    ),
    "auto": frozenset({"um", "uh", "er", "ah"}),
    "telugu": frozenset(),
    "telgish": frozenset({"um", "uh", "er", "ah"}),
}


def _token(value: str) -> str:
    return _EDGE_PUNCTUATION.sub("", value.casefold()).strip()


def _timing(words: Iterable[Word]) -> tuple[int | None, int | None]:
    values = list(words)
    if not values or any(
        word.startMs is None or word.endMs is None for word in values
    ):
        return None, None
    return (
        min(int(word.startMs) for word in values if word.startMs is not None),
        max(int(word.endMs) for word in values if word.endMs is not None),
    )


def _finding(
    *,
    analysis_id: str,
    finding_type: str,
    words: list[Word],
    reason: str,
    severity: str,
    confidence: float | None,
    ordinal: int,
) -> TranscriptFindingV1:
    start, end = _timing(words)
    word_ids = [word.id for word in words]
    segment_ids = list(dict.fromkeys(word.segmentId for word in words))
    identity = {
        "analysisId": analysis_id,
        "type": finding_type,
        "wordIds": word_ids,
        "segmentIds": segment_ids,
        "reason": reason,
        "ordinal": ordinal,
    }
    return TranscriptFindingV1(
        id=stable_id("finding", identity),
        findingType=finding_type,
        wordIds=word_ids,
        segmentIds=segment_ids,
        sourceStartMs=start,
        sourceEndMs=end,
        reasonCode=reason,
        severity=severity,
        confidence=confidence,
        metadata={},
    )


def _filler_findings(
    document: TranscriptDocumentV2, analysis_id: str
) -> list[TranscriptFindingV1]:
    dictionary = _FILLERS.get(document.languageMode, frozenset())
    findings = []
    for word in document.words:
        exact = _token(word.text) in dictionary or (
            word.originalText is not None
            and _token(word.originalText) in dictionary
        )
        if not word.isFiller and not exact:
            continue
        findings.append(
            _finding(
                analysis_id=analysis_id,
                finding_type="filler",
                words=[word],
                reason=(
                    "provider_filler_flag"
                    if word.isFiller
                    else "filler_exact_match"
                ),
                severity="info",
                confidence=1.0 if exact else None,
                ordinal=len(findings),
            )
        )
    return findings


def _low_confidence_findings(
    document: TranscriptDocumentV2,
    analysis_id: str,
    *,
    threshold: float,
    merge_gap_ms: int,
    warnings: set[str],
) -> list[TranscriptFindingV1]:
    candidates: list[Word] = []
    word_positions = {word.id: index for index, word in enumerate(document.words)}
    for word in document.words:
        if word.confidence is None:
            warnings.add("confidence_missing")
        if word.isLowConfidence or (
            word.confidence is not None and word.confidence < threshold
        ):
            candidates.append(word)
    groups: list[list[Word]] = []
    for word in candidates:
        if not groups:
            groups.append([word])
            continue
        previous = groups[-1][-1]
        timed_adjacent = (
            previous.endMs is not None
            and word.startMs is not None
            and word.startMs - previous.endMs <= merge_gap_ms
        )
        untimed_adjacent = previous.endMs is None and word.startMs is None
        same_speaker = previous.speakerId == word.speakerId
        consecutive = word_positions[word.id] == word_positions[previous.id] + 1
        if same_speaker and consecutive and (timed_adjacent or untimed_adjacent):
            groups[-1].append(word)
        else:
            groups.append([word])
    findings = []
    for index, group in enumerate(groups):
        confidences = [
            word.confidence
            for word in group
            if word.confidence is not None
        ]
        findings.append(
            _finding(
                analysis_id=analysis_id,
                finding_type="low_confidence",
                words=group,
                reason=(
                    "provider_low_confidence_flag"
                    if any(word.isLowConfidence for word in group)
                    else "confidence_below_threshold"
                ),
                severity="review",
                confidence=min(confidences) if confidences else None,
                ordinal=index,
            )
        )
    return findings


def _timing_findings(
    document: TranscriptDocumentV2,
    analysis_id: str,
    *,
    boundary_ms: int,
) -> list[TranscriptFindingV1]:
    findings: list[TranscriptFindingV1] = []

    def add(word: Word, reason: str, severity: str = "review") -> None:
        findings.append(
            _finding(
                analysis_id=analysis_id,
                finding_type="timing_quality",
                words=[word],
                reason=reason,
                severity=severity,
                confidence=None,
                ordinal=len(findings),
            )
        )

    previous: Word | None = None
    for word in document.words:
        if word.startMs is None:
            add(word, "word_timing_missing")
        else:
            if word.startMs == word.endMs:
                add(word, "zero_duration_word")
            if (
                word.startMs <= boundary_ms
                or document.durationMs - word.endMs <= boundary_ms
            ):
                add(word, "timing_near_media_boundary", "info")
            if (
                previous is not None
                and previous.endMs is not None
                and word.startMs < previous.endMs
            ):
                add(word, "word_timing_overlap")
        if word.timingSource in {"aligned", "interpolated", "estimated"}:
            add(word, "word_timing_repaired", "info")
        previous = word
    for segment in document.segments:
        if not segment.wordIds:
            if segment.startMs == segment.endMs:
                identity = {
                    "analysisId": analysis_id,
                    "type": "timing_quality",
                    "segmentId": segment.id,
                    "reason": "untimed_segment",
                }
                findings.append(
                    TranscriptFindingV1(
                        id=stable_id("finding", identity),
                        findingType="timing_quality",
                        wordIds=[],
                        segmentIds=[segment.id],
                        sourceStartMs=None,
                        sourceEndMs=None,
                        reasonCode="untimed_segment",
                        severity="review",
                        confidence=None,
                        metadata={},
                    )
                )
        if segment.timingSource in {"aligned", "interpolated", "estimated"}:
            identity = {
                "analysisId": analysis_id,
                "type": "timing_quality",
                "segmentId": segment.id,
                "reason": "segment_timing_repaired",
            }
            findings.append(
                TranscriptFindingV1(
                    id=stable_id("finding", identity),
                    findingType="timing_quality",
                    wordIds=list(segment.wordIds),
                    segmentIds=[segment.id],
                    sourceStartMs=segment.startMs,
                    sourceEndMs=segment.endMs,
                    reasonCode="segment_timing_repaired",
                    severity="info",
                    confidence=None,
                    metadata={},
                )
            )
    return findings


def _sort_findings(
    findings: list[TranscriptFindingV1],
) -> list[TranscriptFindingV1]:
    return sorted(
        findings,
        key=lambda item: (
            item.sourceStartMs is None,
            item.sourceStartMs or 0,
            item.sourceEndMs or 0,
            item.findingType,
            item.id,
        ),
    )


def recommendations_for_findings(
    analysis_id: str,
    findings: list[TranscriptFindingV1],
    *,
    duration_ms: int,
) -> list[TimelineRecommendationV1]:
    result: list[TimelineRecommendationV1] = []
    mapping = {
        "filler": (
            "review_filler",
            "review_transcript_word",
            "review",
        ),
        "low_confidence": (
            "review_low_confidence",
            "review_transcript_word",
            "review",
        ),
        "timing_quality": (
            "review_timing",
            "review_transcript_timing",
            "review",
        ),
    }
    for finding in findings:
        recommendation_type, action, severity = mapping[finding.findingType]
        start = finding.sourceStartMs
        end = finding.sourceEndMs
        if end is not None:
            end = min(end, duration_ms)
        if start is not None and end is not None and end <= start:
            start = None
            end = None
        identity = {
            "analysisId": analysis_id,
            "type": recommendation_type,
            "findingId": finding.id,
            "start": start,
            "end": end,
            "reason": finding.reasonCode,
        }
        result.append(
            TimelineRecommendationV1(
                recommendationId=stable_id("rec", identity),
                analysisId=analysis_id,
                recommendationType=recommendation_type,
                sourceStartMs=start,
                sourceEndMs=end,
                wordIds=finding.wordIds,
                segmentIds=finding.segmentIds,
                reasonCode=finding.reasonCode,
                severity=severity,
                analysisConfidence=finding.confidence,
                proposedAction=ProposedActionV1(action=action),
                contributingFindingIds=[finding.id],
                metadata={},
            )
        )
    return sorted(
        {item.recommendationId: item for item in result}.values(),
        key=lambda item: (
            item.sourceStartMs is None,
            item.sourceStartMs or 0,
            item.sourceEndMs or 0,
            item.recommendationType,
            item.recommendationId,
        ),
    )


def analyze_transcript(
    document: TranscriptDocumentV2,
    *,
    analysis_id: str,
    media_asset_id,
    media_revision: int,
    transcript_revision: int,
    kinds: list[str],
    confidence_threshold: float = 0.5,
    merge_gap_ms: int = 300,
    boundary_ms: int = 25,
) -> tuple[
    TranscriptAnalysisDocumentV1, list[TimelineRecommendationV1]
]:
    warnings: set[str] = set()
    findings: list[TranscriptFindingV1] = []
    if "fillers" in kinds:
        findings.extend(_filler_findings(document, analysis_id))
    if "confidence" in kinds:
        findings.extend(
            _low_confidence_findings(
                document,
                analysis_id,
                threshold=confidence_threshold,
                merge_gap_ms=merge_gap_ms,
                warnings=warnings,
            )
        )
    if "timing_quality" in kinds:
        findings.extend(
            _timing_findings(
                document, analysis_id, boundary_ms=boundary_ms
            )
        )
    findings = _sort_findings(findings)
    document_result = TranscriptAnalysisDocumentV1(
        analysisId=analysis_id,
        mediaAssetId=media_asset_id,
        mediaRevision=media_revision,
        transcriptId=document.transcriptId,
        transcriptRevision=transcript_revision,
        language=(
            document.detectedLanguages[0]
            if document.detectedLanguages
            else document.languageMode
        ),
        findings=findings,
        summary=TranscriptAnalysisSummaryV1(
            fillerCount=sum(x.findingType == "filler" for x in findings),
            lowConfidenceWordCount=sum(
                len(x.wordIds)
                for x in findings
                if x.findingType == "low_confidence"
            ),
            timingReviewCount=sum(
                x.findingType == "timing_quality" for x in findings
            ),
        ),
        warnings=sorted(warnings),
        metadata={
            "fillerDictionaryVersion": "existing-preprocessor-v1",
            "confidenceThreshold": confidence_threshold,
        },
    )
    recommendations = recommendations_for_findings(
        analysis_id, findings, duration_ms=document.durationMs
    )
    return document_result, recommendations


__all__ = ["analyze_transcript", "recommendations_for_findings"]
