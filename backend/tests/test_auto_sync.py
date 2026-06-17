from ai_pipeline.sync.activity import build_caption_activity_from_segments
from ai_pipeline.sync.auto_sync import apply_auto_sync_if_confident, estimate_global_shift


def test_shifted_caption_activity_estimates_negative_correction():
    speech_segments = [{"start": 1.0, "end": 2.0, "text": "speech"}]
    late_caption_segments = [{"start": 1.4, "end": 2.4, "text": "speech"}]
    speech = build_caption_activity_from_segments(speech_segments, frame_step=0.1, duration_seconds=4.0)
    captions = build_caption_activity_from_segments(late_caption_segments, frame_step=0.1, duration_seconds=4.0)
    estimate = estimate_global_shift(captions, speech, frame_step=0.1, max_shift_seconds=1.0)
    assert abs(estimate["shiftSeconds"] + 0.4) <= 0.11
    assert estimate["bestScore"] > estimate["baselineScore"]


def test_low_overlap_has_low_score():
    speech = build_caption_activity_from_segments([{"start": 1.0, "end": 1.2, "text": "a"}], frame_step=0.1, duration_seconds=5.0)
    captions = build_caption_activity_from_segments([{"start": 4.0, "end": 4.2, "text": "b"}], frame_step=0.1, duration_seconds=5.0)
    estimate = estimate_global_shift(captions, speech, frame_step=0.1, max_shift_seconds=0.2)
    assert estimate["bestScore"] == 0


def test_auto_sync_skips_when_estimated_word_ratio_is_high():
    import ai_pipeline.sync.auto_sync as auto_sync

    def fake_estimate(*_args, **_kwargs):
        return auto_sync.SyncPassResult(
            [],
            {
                "applied": False,
                "shiftSeconds": 0.04,
                "skew": 0.999,
                "baselineScore": 0.6,
                "bestScore": 0.745,
                "improvement": 0.145,
                "quality": 0.745,
                "warnings": [],
            },
        )

    original = auto_sync.estimate_global_shift_and_skew
    auto_sync.estimate_global_shift_and_skew = fake_estimate
    segments = [
        {
            "start": 0,
            "end": 1,
            "words": [
                {"word": "next", "start": 0, "end": 0.3, "timingSource": "estimated"},
                {"word": "again", "start": 0.3, "end": 0.6, "timingSource": "estimated"},
            ],
        }
    ]
    try:
        result = apply_auto_sync_if_confident(
            segments,
            "missing.wav",
            config={"enabled": True, "minScore": 0.5, "minImprovement": 0.01, "maxEstimatedWordRatio": 0.5},
        )
    finally:
        auto_sync.estimate_global_shift_and_skew = original
    assert result.report["applied"] is False
    assert result.report["rejectReason"] == "too_many_estimated_word_timings"
    assert result.report["recommendation"]["shiftSeconds"] == 0.04
