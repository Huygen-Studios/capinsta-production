from ai_pipeline.sync.pause_preserver import preserve_detected_pauses

def test_preserve_detected_pauses_repairs_locally_without_global_shift():
    segments = [
        {
            "words": [
                {"word": "word1", "start": 1.0, "end": 3.0},
                {"word": "word2", "start": 3.1, "end": 3.5},
                {"word": "word3", "start": 3.6, "end": 4.0},
            ]
        }
    ]
    silence_gaps = [
        {"start": 2.0, "end": 5.0, "duration": 3.0}
    ]
    pause_threshold = 0.45
    
    diagnostics = {}
    result = preserve_detected_pauses(
        segments,
        silence_gaps,
        pause_threshold,
        diagnostics=diagnostics,
    )
    
    # word1 should be clamped to silence start (2.0)
    assert result[0]["words"][0]["end"] == 2.0
    
    # word2 and word3 are repaired locally to the silence end. The pause
    # preserver no longer shifts a cascade of later words across the transcript.
    assert result[0]["words"][1]["start"] == 5.0
    assert result[0]["words"][1]["end"] == 5.4
    assert result[0]["words"][2]["start"] == 5.0
    assert result[0]["words"][2]["end"] == 5.4
    assert result[0]["words"][0]["timing_source"] == "provider_native_unconfirmed"
    assert result[0]["words"][1]["timing_source"] == "provider_native_unconfirmed"
    assert diagnostics["pauseGapsApplied"] == 1
    assert diagnostics["pauseGapsAlreadyPreserved"] == 0
    assert diagnostics["wordsShiftedForPause"] == 0
    assert diagnostics["wordsClampedForPause"] == 3
    assert diagnostics["wordsRejectedForCrossingHardGap"] == 3
    assert diagnostics["sameGroupOverlapCaps"] == 0
    assert diagnostics["sameGroupOverlapUnrepairable"] == 1
    assert diagnostics["timingMutationSamples"] == [
        {
            "stage": "pause_preservation",
            "alignmentGroupId": "segment:0",
            "word": "word2",
            "originalStart": 5.0,
            "originalEnd": 5.4,
            "newStart": 5.0,
            "newEnd": 5.4,
            "nextWord": "word3",
            "nextStart": 5.0,
            "reason": "overlap_unrepairable_before_next_word",
            "sourceStart": None,
            "sourceEnd": None,
            "decision": "kept_original_timing",
        }
    ]
    assert {
        key: diagnostics[key]
        for key in (
            "pauseGapsApplied",
            "pauseGapsAlreadyPreserved",
            "wordsShiftedForPause",
            "wordsClampedForPause",
            "wordsRejectedForCrossingHardGap",
            "sameGroupOverlapCaps",
            "pauseCandidateRollbacks",
        )
    } == {
        "pauseGapsApplied": 1,
        "pauseGapsAlreadyPreserved": 0,
        "wordsShiftedForPause": 0,
        "wordsClampedForPause": 3,
        "wordsRejectedForCrossingHardGap": 3,
        "sameGroupOverlapCaps": 0,
        "pauseCandidateRollbacks": 0,
    }
    
    # segment bounds should be recalculated
    assert result[0]["start"] == 1.0
    assert result[0]["end"] == 5.4

def test_preserve_detected_pauses_no_change_when_no_silence():
    segments = [
        {
            "words": [
                {"word": "word1", "start": 1.0, "end": 1.5},
                {"word": "word2", "start": 1.6, "end": 2.0},
            ]
        }
    ]
    silence_gaps = []
    pause_threshold = 0.45
    
    result = preserve_detected_pauses(segments, silence_gaps, pause_threshold)
    assert result[0]["words"][0]["end"] == 1.5
    assert result[0]["words"][1]["start"] == 1.6


def test_preserved_words_keep_full_detected_pause_and_no_future_word_is_active():
    segments = [
        {
            "words": [
                {"word": "spends", "start": 0.5, "end": 0.9},
                {"word": "around", "start": 0.9, "end": 1.2},
                {"word": "22", "start": 1.25, "end": 1.45},
                {"word": "lakh", "start": 1.46, "end": 1.7},
                {"word": "crore", "start": 1.71, "end": 2.0},
            ]
        }
    ]
    silence_gaps = [{"start": 1.2, "end": 2.4, "duration": 1.2}]

    result = preserve_detected_pauses(segments, silence_gaps, 0.45)
    words = result[0]["words"]

    assert words[2]["start"] - words[1]["end"] >= 1.2
    assert not any(word["start"] <= 1.8 < word["end"] for word in words)


def test_already_preserved_gap_is_counted_without_retiming_words():
    segments = [
        {
            "words": [
                {"word": "before", "start": 0.5, "end": 1.0},
                {"word": "after", "start": 2.2, "end": 2.6},
            ]
        }
    ]
    diagnostics = {}

    result = preserve_detected_pauses(
        segments,
        [{"start": 1.0, "end": 2.2, "duration": 1.2}],
        0.3,
        diagnostics=diagnostics,
    )

    assert result[0]["words"][1]["start"] == 2.2
    assert diagnostics == {
        "pauseGapsApplied": 1,
        "pauseGapsAlreadyPreserved": 1,
        "wordsShiftedForPause": 0,
        "wordsClampedForPause": 0,
        "wordsRejectedForCrossingHardGap": 0,
        "sameGroupOverlapCaps": 0,
        "pauseCandidateRollbacks": 0,
    }


def test_pause_preserved_previous_word_is_capped_before_next_word():
    segments = [
        {
            "words": [
                {
                    "word": "sare",
                    "start": 17.248,
                    "end": 17.486,
                    "alignmentGroupId": "turn-1",
                    "sourceStart": 17.0,
                    "sourceEnd": 17.6,
                    "timingSource": "stable_ts_forced_align",
                },
                {
                    "word": "ippudu",
                    "start": 17.446,
                    "end": 17.486,
                    "alignmentGroupId": "turn-1",
                    "sourceStart": 17.0,
                    "sourceEnd": 17.6,
                    "timingSource": "stable_ts_forced_align",
                },
            ]
        }
    ]
    diagnostics = {}

    result = preserve_detected_pauses(
        segments,
        [{"start": 16.9, "end": 17.0, "duration": 0.1}],
        0.05,
        diagnostics=diagnostics,
    )

    words = result[0]["words"]
    assert words[0]["end"] == 17.445
    assert words[1]["start"] == 17.446
    assert words[1]["end"] == 17.486
    assert words[0]["timingRepairReason"] == "overlap_trimmed_before_next_word"
    assert diagnostics["sameGroupOverlapCaps"] == 1
    assert diagnostics["timingMutationSamples"][0]["word"] == "sare"


def test_pause_preservation_rolls_back_invalid_same_group_candidate_ag_0027():
    segments = [
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
    ]
    diagnostics = {}

    result = preserve_detected_pauses(
        segments,
        [
            {"start": 38.496, "end": 39.204, "duration": 0.708},
            {"start": 39.520, "end": 40.000, "duration": 0.480},
        ],
        0.25,
        diagnostics=diagnostics,
    )

    words = result[0]["words"]
    assert [(word["word"], word["start"], word["end"]) for word in words] == [
        ("istaav", 38.064, 38.104),
        ("ippudu", 38.104, 39.164),
        ("gaa", 39.204, 40.604),
    ]
    assert diagnostics["pauseCandidateRollbacks"] == 1
    assert diagnostics["pauseCandidateDecisions"][0]["alignmentGroupId"] == "ag-0027"
    assert diagnostics["pauseCandidateDecisions"][0]["decision"] == "rollback"
    assert "word[1]" in diagnostics["pauseCandidateDecisions"][0]["violation"]
