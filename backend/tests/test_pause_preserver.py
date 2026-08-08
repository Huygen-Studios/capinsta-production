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
    
    # The later candidate words would both be pushed to the same silence end,
    # so the whole unsafe gap candidate is rolled back instead of partially
    # committing a pause repair that creates overlapping words.
    assert result[0]["words"][0]["end"] == 3.0

    assert result[0]["words"][1]["start"] == 3.1
    assert result[0]["words"][1]["end"] == 3.5
    assert result[0]["words"][2]["start"] == 3.6
    assert result[0]["words"][2]["end"] == 4.0
    assert result[0]["words"][0].get("timing_source") != "provider_native_unconfirmed"
    assert result[0]["words"][1].get("timing_source") != "provider_native_unconfirmed"
    assert diagnostics["pauseGapsApplied"] == 0
    assert diagnostics["pauseGapsAlreadyPreserved"] == 0
    assert diagnostics["wordsShiftedForPause"] == 0
    assert diagnostics["wordsClampedForPause"] == 0
    assert diagnostics["wordsRejectedForCrossingHardGap"] == 0
    assert diagnostics["sameGroupOverlapCaps"] == 0
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
        "pauseGapsApplied": 0,
        "pauseGapsAlreadyPreserved": 0,
        "wordsShiftedForPause": 0,
        "wordsClampedForPause": 0,
        "wordsRejectedForCrossingHardGap": 0,
        "sameGroupOverlapCaps": 0,
        "pauseCandidateRollbacks": 3,
    }
    
    # segment bounds should be recalculated
    assert result[0]["start"] == 1.0
    assert result[0]["end"] == 4.0


def test_pause_preservation_rolls_back_cross_group_candidate_collision():
    segments = [
        {
            "words": [
                {
                    "word": "before",
                    "start": 42.2,
                    "end": 42.72,
                    "alignmentGroupId": "ag-before",
                    "sourceStart": 41.0,
                    "sourceEnd": 43.5,
                },
                {
                    "word": "one",
                    "start": 42.65,
                    "end": 43.1,
                    "alignmentGroupId": "ag-one",
                    "sourceStart": 41.0,
                    "sourceEnd": 43.5,
                },
                {
                    "word": "two",
                    "start": 42.66,
                    "end": 43.2,
                    "alignmentGroupId": "ag-two",
                    "sourceStart": 41.0,
                    "sourceEnd": 43.5,
                },
            ]
        }
    ]
    diagnostics = {}

    result = preserve_detected_pauses(
        segments,
        [{"start": 42.7, "end": 42.72, "duration": 0.02}],
        0.01,
        diagnostics=diagnostics,
    )

    words = result[0]["words"]
    assert words[1]["start"] == 42.65
    assert words[1]["end"] == 43.1
    assert words[2]["start"] == 42.66
    assert words[2]["end"] == 43.2
    assert diagnostics["pauseCandidateRollbacks"] >= 1
    assert any(
        decision.get("violation", {}).get("violation") == "chronological_overlap_after_pause_candidate"
        for decision in diagnostics.get("pauseCandidateDecisions", [])
    )

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

    assert words[2]["start"] == 1.25
    assert words[3]["start"] == 1.46
    assert words[4]["start"] == 1.71


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
    assert words[0]["end"] == 17.446
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
