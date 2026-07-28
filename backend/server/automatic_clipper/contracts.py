from __future__ import annotations

import re
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

_HASH = re.compile(r"^[0-9a-f]{64}$")
_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ViralCandidateAnalysisJobInputV1(StrictModel):
    schemaVersion: Literal[1] = 1
    jobType: Literal["viral_candidate_analysis"] = "viral_candidate_analysis"
    analysisId: str
    clipProjectId: str
    expectedProjectRevision: int = Field(ge=1)
    mediaAssetId: UUID
    expectedMediaRevision: int = Field(ge=1)
    transcriptId: str
    expectedTranscriptRevision: int = Field(ge=1)
    promptVersion: Literal["viral-candidates-v1"] = "viral-candidates-v1"
    analysisSpecHash: str

    @model_validator(mode="after")
    def valid_identity(self):
        if not all(
            _ID.fullmatch(value)
            for value in (self.analysisId, self.clipProjectId, self.transcriptId)
        ):
            raise ValueError("invalid durable identity")
        if not _HASH.fullmatch(self.analysisSpecHash):
            raise ValueError("invalid analysis specification hash")
        return self


class CandidateScoreBreakdownV1(StrictModel):
    hookStrength: int = Field(ge=0, le=20)
    clarity: int = Field(ge=0, le=20)
    payoff: int = Field(ge=0, le=20)
    emotion: int = Field(ge=0, le=20)
    novelty: int = Field(ge=0, le=20)


class TranscriptEvidenceV1(StrictModel):
    wordIds: list[str] = Field(default_factory=list, max_length=10_000)
    segmentIds: list[str] = Field(default_factory=list, max_length=2_000)
    excerpt: str = Field(default="", max_length=280)


class ViralCandidateProposalV1(StrictModel):
    sourceStartMs: int = Field(ge=0)
    sourceEndMs: int = Field(gt=0)
    title: str = Field(default="", max_length=80)
    hookText: str = Field(default="", max_length=120)
    supportingEmojis: list[str] = Field(default_factory=list, max_length=2)
    scoreBreakdown: CandidateScoreBreakdownV1
    reason: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def valid_range(self):
        if self.sourceEndMs <= self.sourceStartMs:
            raise ValueError("candidate proposal range is invalid")
        return self


class ViralCandidateV1(StrictModel):
    candidateId: str
    sourceStartMs: int = Field(ge=0)
    sourceEndMs: int = Field(gt=0)
    durationMs: int = Field(gt=0)
    title: str = Field(max_length=80)
    hookText: str = Field(max_length=120)
    supportingEmojis: list[str] = Field(max_length=2)
    viralScore: int = Field(ge=0, le=100)
    scoreBreakdown: CandidateScoreBreakdownV1
    reason: str = Field(max_length=500)
    transcriptEvidence: TranscriptEvidenceV1
    recommendedFramingStrategy: Literal[
        "automatic",
        "preserve_vertical",
        "single_subject_crop",
        "dual_subject_split",
        "speaker_screen_stack",
        "fit_blurred_background",
        "manual_safe_crop",
    ]
    recommendedCaptionPreset: str = Field(min_length=1, max_length=100)
    warnings: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def valid_timing(self):
        if (
            self.sourceEndMs <= self.sourceStartMs
            or self.durationMs != self.sourceEndMs - self.sourceStartMs
        ):
            raise ValueError("candidate timing is invalid")
        return self


class ViralCandidateAnalysisDocumentV1(StrictModel):
    schemaVersion: Literal[1]
    transcriptId: str
    mediaId: str
    durationMs: int = Field(ge=0)
    promptVersion: Literal["viral-candidates-v1"]
    provider: dict[str, Any]
    candidates: list[ViralCandidateV1] = Field(max_length=8)
    warnings: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def valid_document(self):
        ids = [item.candidateId for item in self.candidates]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate candidate ID")
        if any(item.sourceEndMs > self.durationMs for item in self.candidates):
            raise ValueError("candidate exceeds media duration")
        if self.candidates != sorted(
            self.candidates,
            key=lambda item: (-item.viralScore, item.sourceStartMs, item.sourceEndMs),
        ):
            raise ValueError("candidate order is not deterministic")
        return self


class NormalizedFaceBoxV1(StrictModel):
    timeMs: int = Field(ge=0)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    confidence: float = Field(ge=0, le=1)
    trackId: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def within_frame(self):
        if self.x + self.width > 1.0001 or self.y + self.height > 1.0001:
            raise ValueError("face box exceeds frame")
        return self


class CropKeyframeV1(StrictModel):
    id: str
    sourceTimeMs: int = Field(ge=0)
    centerX: float = Field(ge=0, le=1)
    centerY: float = Field(ge=0, le=1)
    scale: float = Field(gt=0, le=10)


class LayoutRegionV1(StrictModel):
    id: str
    role: Literal["subject_1", "subject_2", "speaker", "screen"]
    sourceCenterX: float = Field(ge=0, le=1)
    sourceCenterY: float = Field(ge=0, le=1)
    outputCenterX: float = Field(ge=0, le=1)
    outputCenterY: float = Field(ge=0, le=1)
    outputWidth: float = Field(gt=0, le=1)
    outputHeight: float = Field(gt=0, le=1)


class ReframeShotV1(StrictModel):
    sourceStartMs: int = Field(ge=0)
    sourceEndMs: int = Field(gt=0)
    strategy: Literal[
        "preserve_vertical",
        "single_subject_crop",
        "dual_subject_split",
        "speaker_screen_stack",
        "fit_blurred_background",
        "manual_safe_crop",
    ]
    cropKeyframes: list[CropKeyframeV1] = Field(default_factory=list, max_length=500)
    layoutRegions: list[LayoutRegionV1] = Field(default_factory=list, max_length=4)
    confidence: float = Field(ge=0, le=1)
    reasonCode: str

    @model_validator(mode="after")
    def valid_range(self):
        if self.sourceEndMs <= self.sourceStartMs:
            raise ValueError("shot timing is invalid")
        return self


class ReframePlanV1(StrictModel):
    schemaVersion: Literal[1]
    candidateId: str
    sourceWidth: int = Field(gt=0)
    sourceHeight: int = Field(gt=0)
    targetWidth: Literal[1080]
    targetHeight: Literal[1920]
    detectorVersion: str | None = None
    shots: list[ReframeShotV1] = Field(min_length=1, max_length=100)
    warnings: list[str] = Field(default_factory=list, max_length=50)


class SmartReframeJobInputV1(StrictModel):
    schemaVersion: Literal[1] = 1
    jobType: Literal["smart_reframe"] = "smart_reframe"
    clipProjectId: str
    candidateId: str
    expectedProjectRevision: int = Field(ge=1)
    expectedMediaRevision: int = Field(ge=1)
    expectedTranscriptRevision: int = Field(ge=1)
    selection: CandidateSelectionRequestV1


class HookOverlayV1(StrictModel):
    text: str = Field(default="", max_length=120)
    supportingEmojis: list[str] = Field(default_factory=list, max_length=2)
    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)
    position: Literal["top", "upper_third", "center"]
    maximumLines: int = Field(ge=1, le=2)
    stylePreset: str
    animationPreset: str
    safeZoneProfile: Literal[
        "shorts-generic-v1", "tiktok-v1", "reels-v1", "youtube-shorts-v1"
    ]
    transcriptEvidence: TranscriptEvidenceV1


class CandidateSelectionRequestV1(StrictModel):
    expectedRevision: int = Field(ge=1)
    hookText: str | None = Field(default=None, max_length=120)
    supportingEmojis: list[str] | None = Field(default=None, max_length=2)
    framingStrategy: Literal[
        "automatic",
        "preserve_vertical",
        "single_subject_crop",
        "dual_subject_split",
        "speaker_screen_stack",
        "fit_blurred_background",
        "manual_safe_crop",
    ] = "automatic"
    captionPreset: str = Field(default="word_highlight_box", max_length=100)
    wordSpacing: float = Field(default=8, ge=-10, le=100)
    safeZoneProfile: Literal[
        "shorts-generic-v1", "tiktok-v1", "reels-v1", "youtube-shorts-v1"
    ] = "shorts-generic-v1"


class CandidateDecisionRequestV1(StrictModel):
    expectedRevision: int = Field(ge=1)


class CandidateRegenerateRequestV1(StrictModel):
    expectedRevision: int = Field(ge=1)


class AutomaticClipperJobResultV1(StrictModel):
    schemaVersion: Literal[1] = 1
    jobType: Literal["viral_candidate_analysis", "smart_reframe"]
    clipProjectId: str
    projectRevision: int = Field(ge=1)
    candidateCount: int = Field(default=0, ge=0, le=8)
    candidateId: str | None = None
    resultIdentity: str
    warnings: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def valid_identity(self):
        if not _HASH.fullmatch(self.resultIdentity):
            raise ValueError("invalid result identity")
        return self


SmartReframeJobInputV1.model_rebuild()


__all__ = [
    "AutomaticClipperJobResultV1",
    "CandidateDecisionRequestV1",
    "CandidateRegenerateRequestV1",
    "CandidateSelectionRequestV1",
    "HookOverlayV1",
    "NormalizedFaceBoxV1",
    "ReframePlanV1",
    "SmartReframeJobInputV1",
    "ViralCandidateAnalysisDocumentV1",
    "ViralCandidateAnalysisJobInputV1",
    "ViralCandidateProposalV1",
    "ViralCandidateV1",
]
