import os

import ai_pipeline.sync.high_quality as high_quality
from ai_pipeline.sync.high_quality import run_high_quality_alignment
from ai_pipeline.sync.report import SyncPassResult


def test_high_quality_alignment_unavailable_is_clear_and_non_mutating():
    old_stable = os.environ.get("ENABLE_STABLE_TS")
    old_whisperx = os.environ.get("ENABLE_WHISPERX")
    os.environ["ENABLE_STABLE_TS"] = "false"
    os.environ["ENABLE_WHISPERX"] = "false"
    segments = [{"start": 0, "end": 1, "text": "hello", "words": [{"word": "hello", "start": 0, "end": 1, "timingSource": "estimated"}]}]
    try:
        result = run_high_quality_alignment(segments, "missing.wav", "english")
    finally:
        if old_stable is None:
            os.environ.pop("ENABLE_STABLE_TS", None)
        else:
            os.environ["ENABLE_STABLE_TS"] = old_stable
        if old_whisperx is None:
            os.environ.pop("ENABLE_WHISPERX", None)
        else:
            os.environ["ENABLE_WHISPERX"] = old_whisperx

    assert result.report["applied"] is False
    assert result.report["reason"] == "aligner_unavailable"
    assert "High Quality Alignment unavailable" in result.report["userMessage"]
    assert result.segments == segments


def test_successful_high_quality_alignment_rebuilds_segments_from_aligned_words():
    old_status = high_quality.high_quality_alignment_status
    old_refine = high_quality.apply_stable_refinement

    def fake_status():
        return {
            "highQualityAlignmentAvailable": True,
            "stableTsEnabled": True,
            "stableTsAvailable": True,
            "whisperxEnabled": False,
            "whisperxAvailable": False,
        }

    def fake_refine(segments, *_args, **_kwargs):
        next_segments = [
            {
                **segments[0],
                "words": [
                    {"word": "next", "displayedWord": "next", "spokenWord": "next", "start": 11.04, "end": 11.22, "timingSource": "stable_ts_forced_align"},
                    {"word": "next", "displayedWord": "next", "spokenWord": "next", "start": 11.25, "end": 11.43, "timingSource": "stable_ts_forced_align"},
                ],
            }
        ]
        return SyncPassResult(next_segments, {"applied": True, "reason": "test"})

    high_quality.high_quality_alignment_status = fake_status
    high_quality.apply_stable_refinement = fake_refine
    try:
        result = run_high_quality_alignment([{"start": 0, "end": 1, "text": "next next", "words": []}], "audio.wav", "english")
    finally:
        high_quality.high_quality_alignment_status = old_status
        high_quality.apply_stable_refinement = old_refine

    assert result.report["applied"] is True
    assert result.report["captionBuild"]["sourceOfTruth"] == "alignedWords"
    assert result.segments[0]["start"] == 11.04
    assert result.segments[0]["words"][0]["timingSource"] == "stable_ts_forced_align"
