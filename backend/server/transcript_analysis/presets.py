from __future__ import annotations

from .identity import canonical_hash

SILENCE_SPEC = {
    "schemaVersion": 1,
    "preset": "speech-silence-v1",
    "minimumSilenceDurationMs": 500,
    "noiseThresholdDb": -35,
    "edgePaddingMs": 100,
    "minimumRetainedSpeechMs": 250,
    "mergeGapMs": 100,
    "excludeLeadingSilence": True,
    "excludeTrailingSilence": True,
}

TRANSCRIPT_REVIEW_SPEC = {
    "schemaVersion": 1,
    "preset": "transcript-review-v1",
    "analysisKinds": ["confidence", "fillers", "timing_quality"],
    "fillerDictionaryVersion": "existing-preprocessor-v1",
    "wordConfidenceThreshold": 0.5,
    "regionMergeGapMs": 300,
    "includeProviderLowConfidenceFlag": True,
    "includeRepairedTiming": True,
    "timingBoundaryToleranceMs": 25,
}

SILENCE_SPEC_HASH = canonical_hash(SILENCE_SPEC)
TRANSCRIPT_REVIEW_SPEC_HASH = canonical_hash(TRANSCRIPT_REVIEW_SPEC)

__all__ = [
    "SILENCE_SPEC",
    "SILENCE_SPEC_HASH",
    "TRANSCRIPT_REVIEW_SPEC",
    "TRANSCRIPT_REVIEW_SPEC_HASH",
]
