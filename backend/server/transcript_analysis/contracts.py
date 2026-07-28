from __future__ import annotations

import re
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

_ID = re.compile(r"^(analysis|finding|silence|rec)_[A-Za-z0-9_-]{1,124}$")
_HASH = re.compile(r"^[0-9a-f]{64}$")


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SilenceAnalysisJobInputV1(ContractModel):
    schemaVersion: Literal[1] = 1
    jobType: Literal["silence_analysis"] = "silence_analysis"
    analysisId: str
    mediaAssetId: UUID
    expectedMediaRevision: int = Field(ge=1)
    transcriptId: str
    expectedTranscriptRevision: int = Field(ge=1)
    audioVariantId: UUID
    expectedAudioVariantRevision: int = Field(ge=1)
    analysisSpecHash: str
    preset: Literal["speech-silence-v1"]
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_identity(self):
        if not _ID.fullmatch(self.analysisId):
            raise ValueError("analysisId is invalid")
        if not self.transcriptId.startswith("tr_"):
            raise ValueError("transcriptId is invalid")
        if not _HASH.fullmatch(self.analysisSpecHash):
            raise ValueError("analysisSpecHash is invalid")
        return self


class TranscriptAnalysisJobInputV1(ContractModel):
    schemaVersion: Literal[1] = 1
    jobType: Literal["transcript_analysis"] = "transcript_analysis"
    analysisId: str
    mediaAssetId: UUID
    expectedMediaRevision: int = Field(ge=1)
    transcriptId: str
    expectedTranscriptRevision: int = Field(ge=1)
    analysisSpecHash: str
    analysisKinds: list[
        Literal["fillers", "confidence", "timing_quality"]
    ] = Field(min_length=1, max_length=3)
    preset: Literal["transcript-review-v1"]
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_identity(self):
        if not _ID.fullmatch(self.analysisId):
            raise ValueError("analysisId is invalid")
        if not self.transcriptId.startswith("tr_"):
            raise ValueError("transcriptId is invalid")
        if not _HASH.fullmatch(self.analysisSpecHash):
            raise ValueError("analysisSpecHash is invalid")
        if self.analysisKinds != sorted(set(self.analysisKinds)):
            raise ValueError("analysisKinds must be sorted and unique")
        return self


class SilenceIntervalV1(ContractModel):
    id: str
    sourceStartMs: int = Field(ge=0)
    sourceEndMs: int = Field(gt=0)
    durationMs: int = Field(gt=0)
    classification: Literal["silence"] = "silence"
    analysisConfidence: float | None = Field(default=None, ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid_range(self):
        if (
            self.sourceEndMs <= self.sourceStartMs
            or self.durationMs != self.sourceEndMs - self.sourceStartMs
        ):
            raise ValueError("invalid silence interval")
        return self


class SilenceSummaryV1(ContractModel):
    intervalCount: int = Field(ge=0)
    totalSilenceMs: int = Field(ge=0)
    longestSilenceMs: int = Field(ge=0)


class SilenceAnalysisDocumentV1(ContractModel):
    schemaVersion: Literal[1] = 1
    analysisId: str
    mediaAssetId: UUID
    mediaRevision: int = Field(ge=1)
    transcriptId: str
    transcriptRevision: int = Field(ge=1)
    audioVariantId: UUID
    audioVariantRevision: int = Field(ge=1)
    durationMs: int = Field(ge=0)
    preset: Literal["speech-silence-v1"]
    intervals: list[SilenceIntervalV1] = Field(default_factory=list)
    summary: SilenceSummaryV1
    warnings: list[str] = Field(default_factory=list, max_length=100)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_document(self):
        if not _ID.fullmatch(self.analysisId):
            raise ValueError("analysisId is invalid")
        previous_end = -1
        for interval in self.intervals:
            if interval.sourceEndMs > self.durationMs:
                raise ValueError("silence interval exceeds duration")
            if interval.sourceStartMs < previous_end:
                raise ValueError("silence intervals overlap")
            previous_end = interval.sourceEndMs
        durations = [item.durationMs for item in self.intervals]
        if self.summary != SilenceSummaryV1(
            intervalCount=len(durations),
            totalSilenceMs=sum(durations),
            longestSilenceMs=max(durations, default=0),
        ):
            raise ValueError("silence summary mismatch")
        if self.warnings != sorted(set(self.warnings)):
            raise ValueError("warnings must be sorted and unique")
        return self


class TranscriptFindingV1(ContractModel):
    id: str
    findingType: Literal["filler", "low_confidence", "timing_quality"]
    wordIds: list[str] = Field(default_factory=list)
    segmentIds: list[str] = Field(default_factory=list)
    sourceStartMs: int | None = Field(default=None, ge=0)
    sourceEndMs: int | None = Field(default=None, ge=0)
    reasonCode: str = Field(min_length=1, max_length=100)
    severity: Literal["info", "review", "warning"]
    confidence: float | None = Field(default=None, ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid_finding(self):
        if not _ID.fullmatch(self.id):
            raise ValueError("finding id is invalid")
        if (self.sourceStartMs is None) != (self.sourceEndMs is None):
            raise ValueError("finding timing must be paired")
        if (
            self.sourceStartMs is not None
            and self.sourceEndMs is not None
            and self.sourceEndMs < self.sourceStartMs
        ):
            raise ValueError("finding timing is invalid")
        if self.wordIds != list(dict.fromkeys(self.wordIds)):
            raise ValueError("duplicate word reference")
        if self.segmentIds != list(dict.fromkeys(self.segmentIds)):
            raise ValueError("duplicate segment reference")
        return self


class TranscriptAnalysisSummaryV1(ContractModel):
    fillerCount: int = Field(ge=0)
    lowConfidenceWordCount: int = Field(ge=0)
    timingReviewCount: int = Field(ge=0)


class TranscriptAnalysisDocumentV1(ContractModel):
    schemaVersion: Literal[1] = 1
    analysisId: str
    mediaAssetId: UUID
    mediaRevision: int = Field(ge=1)
    transcriptId: str
    transcriptRevision: int = Field(ge=1)
    language: str | None = None
    findings: list[TranscriptFindingV1] = Field(default_factory=list)
    summary: TranscriptAnalysisSummaryV1
    warnings: list[str] = Field(default_factory=list, max_length=100)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_document(self):
        if not _ID.fullmatch(self.analysisId):
            raise ValueError("analysisId is invalid")
        ids = [finding.id for finding in self.findings]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate finding id")
        if self.warnings != sorted(set(self.warnings)):
            raise ValueError("warnings must be sorted and unique")
        if self.summary.fillerCount != sum(
            item.findingType == "filler" for item in self.findings
        ):
            raise ValueError("filler summary mismatch")
        low_word_count = len({
            word_id
            for item in self.findings
            if item.findingType == "low_confidence"
            for word_id in item.wordIds
        })
        if self.summary.lowConfidenceWordCount != low_word_count:
            raise ValueError("confidence summary mismatch")
        if self.summary.timingReviewCount != sum(
            item.findingType == "timing_quality" for item in self.findings
        ):
            raise ValueError("timing summary mismatch")
        return self


class ProposedActionV1(ContractModel):
    action: Literal[
        "exclude_source_interval",
        "review_transcript_word",
        "review_transcript_timing",
    ]
    paddingBeforeMs: int | None = Field(default=None, ge=0, le=5000)
    paddingAfterMs: int | None = Field(default=None, ge=0, le=5000)


class TimelineRecommendationV1(ContractModel):
    schemaVersion: Literal[1] = 1
    recommendationId: str
    analysisId: str
    recommendationType: Literal[
        "remove_silence",
        "review_filler",
        "review_low_confidence",
        "review_timing",
    ]
    sourceStartMs: int | None = Field(default=None, ge=0)
    sourceEndMs: int | None = Field(default=None, ge=0)
    wordIds: list[str] = Field(default_factory=list)
    segmentIds: list[str] = Field(default_factory=list)
    reasonCode: str = Field(min_length=1, max_length=100)
    severity: Literal["info", "suggestion", "review", "warning"]
    analysisConfidence: float | None = Field(default=None, ge=0, le=1)
    proposedAction: ProposedActionV1
    contributingFindingIds: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_recommendation(self):
        if not _ID.fullmatch(self.recommendationId):
            raise ValueError("recommendationId is invalid")
        if not _ID.fullmatch(self.analysisId):
            raise ValueError("analysisId is invalid")
        for references in (
            self.wordIds, self.segmentIds, self.contributingFindingIds
        ):
            if references != list(dict.fromkeys(references)):
                raise ValueError("duplicate recommendation reference")
        if (self.sourceStartMs is None) != (self.sourceEndMs is None):
            raise ValueError("recommendation timing must be paired")
        if (
            self.sourceStartMs is not None
            and self.sourceEndMs is not None
            and self.sourceEndMs <= self.sourceStartMs
        ):
            raise ValueError("recommendation timing is invalid")
        if self.recommendationType == "remove_silence":
            if self.proposedAction.action != "exclude_source_interval":
                raise ValueError("invalid silence action")
        elif self.proposedAction.action == "exclude_source_interval":
            raise ValueError("review recommendations cannot exclude media")
        return self


class AnalysisJobResultV1(ContractModel):
    schemaVersion: Literal[1] = 1
    analysisId: str
    analysisType: Literal["silence", "transcript_review"]
    mediaAssetId: UUID
    transcriptId: str
    findingCount: int = Field(ge=0)
    recommendationCount: int = Field(ge=0)
    resultIdentity: str
    warnings: list[str] = Field(default_factory=list, max_length=100)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_result(self):
        if not _ID.fullmatch(self.analysisId):
            raise ValueError("analysisId is invalid")
        if not _HASH.fullmatch(self.resultIdentity):
            raise ValueError("resultIdentity is invalid")
        if self.warnings != sorted(set(self.warnings)):
            raise ValueError("warnings must be sorted and unique")
        return self


__all__ = [
    "AnalysisJobResultV1",
    "SilenceAnalysisDocumentV1",
    "SilenceAnalysisJobInputV1",
    "SilenceIntervalV1",
    "TimelineRecommendationV1",
    "TranscriptAnalysisDocumentV1",
    "TranscriptAnalysisJobInputV1",
    "TranscriptFindingV1",
]
