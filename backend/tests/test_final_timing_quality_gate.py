import pytest

from ai_pipeline.pipeline_config import resolve_pipeline_config, resolve_pipeline_config_with_sources
from ai_pipeline.sync.final_quality_gate import TimingQualityError, validate_final_timing_quality


def _base_config(**overrides):
    return resolve_pipeline_config(
        {
            "vad": {"sileroEnabled": True},
            "alignment": {"allowStableTsOrderFallback": False},
            "quality": {"allowEstimatedWords": True, "maximumEstimatedWordRatio": 0.15},
            **overrides,
        }
    )


def _vad(provider="silero", degraded=False):
    return {"pauseDetectionProvider": provider, "pauseDetectionDegraded": degraded}


def test_final_gate_blocks_estimated_ratio_by_default():
    words = []
    for index in range(5):
        words.append({"word": f"w{index}", "start": index * 0.1, "end": index * 0.1 + 0.05, "timingSource": "deterministic_fallback"})
    segments = [{"words": words}]

    with pytest.raises(TimingQualityError) as exc:
        validate_final_timing_quality(
            segments,
            pipeline_config=_base_config(),
            vad_report=_vad(),
            sync_report={},
        )

    assert exc.value.category == "estimated_word_ratio_exceeded"
    assert exc.value.report["estimatedWordCount"] == 5
    assert exc.value.report["deterministicFallbackWordCount"] == 5
    assert exc.value.report["timingQuality"] == "degraded"
    assert exc.value.report["reviewRequired"] is True


def test_final_gate_reports_partial_and_zero_estimated_ratios():
    partial_report = validate_final_timing_quality(
        [
            {
                "words": [
                    {"word": f"w{index}", "start": index * 0.1, "end": index * 0.1 + 0.05, "timingSource": "deterministic_fallback" if index < 2 else "stable_ts_forced_align"}
                    for index in range(5)
                ]
            }
        ],
        pipeline_config=_base_config(
            quality={
                "allowEstimatedWords": True,
                "maximumEstimatedWordRatio": 0.5,
            }
        ),
        vad_report=_vad(),
        sync_report={},
    )
    zero_estimated_report = validate_final_timing_quality(
        [{"words": [{"word": "ok", "start": 0.0, "end": 0.1, "timingSource": "provider_native"}]}],
        pipeline_config=_base_config(),
        vad_report=_vad(),
        sync_report={},
    )
    zero_word_report = validate_final_timing_quality(
        [{"words": []}],
        pipeline_config=_base_config(),
        vad_report=_vad(),
        sync_report={},
    )

    assert partial_report["passed"] is True
    assert partial_report["estimatedWordCount"] == 2
    assert partial_report["totalWords"] == 5
    assert partial_report["estimatedWordRatio"] == 0.4
    assert partial_report["timingQuality"] == "mixed"
    assert partial_report["reviewRequired"] is True
    assert zero_estimated_report["estimatedWordRatio"] == 0
    assert zero_estimated_report["timingQuality"] == "native"
    assert zero_word_report["totalWords"] == 0
    assert zero_word_report["estimatedWordRatio"] == 0


def test_final_gate_ignores_legacy_maximum_estimated_ratio_snapshot():
    config = _base_config(quality={"allowEstimatedWords": True, "maximumEstimatedWordRatio": 0.0})
    with pytest.raises(TimingQualityError) as exc:
        validate_final_timing_quality(
            [{"words": [{"word": "estimated", "start": 0.0, "end": 0.2, "timingSource": "deterministic_fallback"}]}],
            pipeline_config=config,
            vad_report=_vad(),
            sync_report={},
        )

    assert exc.value.report["estimatedWordRatio"] == 1.0


def test_final_gate_ignores_legacy_allow_estimated_words_snapshot():
    config = _base_config(quality={"allowEstimatedWords": False, "maximumEstimatedWordRatio": 0.0})
    with pytest.raises(TimingQualityError) as exc:
        validate_final_timing_quality(
            [{"words": [{"word": "estimated", "start": 0.0, "end": 0.2, "timingSource": "deterministic_fallback"}]}],
            pipeline_config=config,
            vad_report=_vad(),
            sync_report={},
        )

    assert exc.value.report["estimatedWordRatio"] == 1.0
    assert any(failure["category"] == "estimated_words_disabled" for failure in exc.value.report["failures"])


def test_final_gate_blocks_order_adjusted_when_fallback_disabled():
    segments = [
        {
            "words": [
                {"word": "one", "start": 0.0, "end": 0.2, "timingSource": "stable_ts_order_adjusted"},
                {"word": "two", "start": 0.3, "end": 0.5, "timingSource": "stable_ts_forced_align"},
            ]
        }
    ]

    with pytest.raises(TimingQualityError) as exc:
        validate_final_timing_quality(
            segments,
            pipeline_config=_base_config(),
            vad_report=_vad(),
            sync_report={"stableTs": {"orderFallbackAppliedWords": 1}},
        )

    assert any(
        failure["category"] == "stable_ts_order_fallback_disabled"
        for failure in exc.value.report["failures"]
    )
    assert exc.value.report["stableTsOrderAdjustedCount"] == 1


def test_final_gate_blocks_production_fallback_heavy_alignment_regression():
    words = [
        {
            "word": f"fallback-{index}",
            "start": index * 0.12,
            "end": index * 0.12 + 0.08,
            "timingSource": "deterministic_fallback",
        }
        for index in range(241)
    ]
    words.extend(
        {
            "word": f"stable-{index}",
            "start": (241 + index) * 0.12,
            "end": (241 + index) * 0.12 + 0.08,
            "timingSource": "stable_ts_forced_align",
        }
        for index in range(5)
    )

    with pytest.raises(TimingQualityError) as exc:
        validate_final_timing_quality(
            [{"words": words}],
            pipeline_config=_base_config(),
            vad_report=_vad(),
            sync_report={"stableTs": {"applied": True, "matchCoverage": 0.6382}},
        )

    report = exc.value.report
    assert report["totalWords"] == 246
    assert report["deterministicFallbackWordCount"] == 241
    assert report["stableTimestampWordCount"] == 5
    assert report["estimatedWordRatio"] == 0.9797
    assert report["alignmentApplied"] is True
    assert report["alignmentPartiallyApplied"] is True
    assert report["timingQuality"] == "degraded"
    assert report["reviewRequired"] is True


def test_final_gate_blocks_degraded_pause_detection_when_silero_requested():
    segments = [{"words": [{"word": "ok", "start": 0.0, "end": 0.2, "timingSource": "provider_native"}]}]

    with pytest.raises(TimingQualityError) as exc:
        validate_final_timing_quality(
            segments,
            pipeline_config=_base_config(),
            vad_report=_vad("ffmpeg_energy_fallback", True),
            sync_report={},
        )

    assert exc.value.category == "pause_detector_not_silero"


def test_final_gate_blocks_overlap_and_group_window_escape():
    segments = [
        {
            "words": [
                {"word": "a", "start": 0.0, "end": 0.3, "sourceStart": 0.0, "sourceEnd": 0.4, "alignmentGroupId": "g1", "timingSource": "provider_native"},
                {"word": "b", "start": 0.2, "end": 0.6, "sourceStart": 0.0, "sourceEnd": 0.4, "alignmentGroupId": "g1", "timingSource": "provider_native"},
            ]
        }
    ]

    with pytest.raises(TimingQualityError) as exc:
        validate_final_timing_quality(
            segments,
            pipeline_config=_base_config(),
            vad_report=_vad(),
            sync_report={},
        )

    assert exc.value.category in {"final_word_overlap", "word_outside_alignment_group"}
    assert exc.value.report["overlapCount"] == 1
    assert exc.value.report["outsideAlignmentGroupWindowCount"] == 1


def test_final_gate_blocks_caption_crossing_hard_boundary():
    segments = [
        {
            "words": [
                {"word": "yes", "start": 0.0, "end": 0.2, "alignmentGroupId": "g1", "hardBoundaryAfter": True, "timingSource": "provider_native"},
                {"word": "wait", "start": 0.5, "end": 0.7, "alignmentGroupId": "g2", "hardBoundaryBefore": True, "timingSource": "provider_native"},
            ]
        }
    ]

    with pytest.raises(TimingQualityError) as exc:
        validate_final_timing_quality(
            segments,
            pipeline_config=_base_config(),
            vad_report=_vad(),
            sync_report={},
        )

    assert exc.value.category == "caption_crosses_hard_boundary"


def test_final_gate_blocks_duplicate_token_occurrence():
    segments = [
        {
            "words": [
                {
                    "word": "first",
                    "start": 0.0,
                    "end": 0.2,
                    "alignmentGroupId": "g1",
                    "sourceStart": 0.0,
                    "sourceEnd": 0.5,
                    "providerTokenId": "g1:0:0",
                    "timingSource": "provider_native",
                },
                {
                    "word": "first-again",
                    "start": 0.3,
                    "end": 0.5,
                    "alignmentGroupId": "g1",
                    "sourceStart": 0.0,
                    "sourceEnd": 0.5,
                    "providerTokenId": "g1:0:0",
                    "timingSource": "provider_native",
                },
            ]
        }
    ]

    with pytest.raises(TimingQualityError) as exc:
        validate_final_timing_quality(
            segments,
            pipeline_config=_base_config(),
            vad_report=_vad(),
            sync_report={},
        )

    assert exc.value.category == "duplicate_token_occurrence"
    assert exc.value.report["duplicateTokenCount"] == 1


def test_final_gate_pass_report_contains_sources_and_counts():
    config_sources = resolve_pipeline_config_with_sources({"vad": {"sileroEnabled": True}})["sources"]
    report = validate_final_timing_quality(
        [{"words": [{"word": "ok", "start": 0.0, "end": 0.2, "timingSource": "provider_native", "alignmentGroupId": "g1", "sourceStart": 0.0, "sourceEnd": 0.3}]}],
        pipeline_config=_base_config(),
        vad_report=_vad(),
        sync_report={"alignmentGroups": {"alignmentGroupCount": 1, "boundariesFromRawSpeechGaps": 0}},
        resolved_config_sources=config_sources,
    )

    assert report["passed"] is True
    assert report["pauseDetectionProvider"] == "silero"
    assert report["overlapCount"] == 0
    assert report["stableTsOrderAdjustedCount"] == 0
    assert report["estimatedWordRatio"] == 0
    assert report["suspectedScriptMismatchCount"] == 0
    assert report["resolvedConfigSources"]["vad"]["sileroEnabled"] == "snapshot"


def test_final_gate_blocks_surviving_unsupported_script_tokens():
    with pytest.raises(TimingQualityError) as exc:
        validate_final_timing_quality(
            [
                {
                    "words": [
                        {
                            "word": "ஆம",
                            "start": 0.0,
                            "end": 0.2,
                            "timingSource": "provider_native",
                            "alignmentGroupId": "g1",
                            "sourceStart": 0.0,
                            "sourceEnd": 0.3,
                            "suspectedScriptMismatch": True,
                        }
                    ]
                }
            ],
            pipeline_config=_base_config(),
            vad_report=_vad(),
            sync_report={},
        )

    assert exc.value.category == "suspected_script_mismatch"
    assert exc.value.report["suspectedScriptMismatchCount"] == 1


def test_final_gate_accepts_restored_ag_0027_sequence():
    report = validate_final_timing_quality(
        [
            {
                "words": [
                    {
                        "word": "istaav",
                        "start": 38.064,
                        "end": 38.104,
                        "alignmentGroupId": "ag-0027",
                        "sourceStart": 38.0,
                        "sourceEnd": 40.7,
                        "timingSource": "stable_ts_forced_align",
                    },
                    {
                        "word": "ippudu",
                        "start": 38.104,
                        "end": 39.164,
                        "alignmentGroupId": "ag-0027",
                        "sourceStart": 38.0,
                        "sourceEnd": 40.7,
                        "timingSource": "stable_ts_forced_align",
                    },
                    {
                        "word": "gaa",
                        "start": 39.204,
                        "end": 40.604,
                        "alignmentGroupId": "ag-0027",
                        "sourceStart": 38.0,
                        "sourceEnd": 40.7,
                        "timingSource": "stable_ts_forced_align",
                    },
                ]
            }
        ],
        pipeline_config=_base_config(),
        vad_report=_vad(),
        sync_report={},
    )

    assert report["invalidRangeCount"] == 0
    assert report["overlapCount"] == 0
    assert report["passed"] is True
