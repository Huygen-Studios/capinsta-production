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
    assert result[0]["words"][1]["end"] == 5.4 # original duration was 0.4s
    assert result[0]["words"][2]["start"] == 5.0
    assert result[0]["words"][2]["end"] == 5.4
    assert result[0]["words"][0]["timing_source"] == "provider_native_unconfirmed"
    assert result[0]["words"][1]["timing_source"] == "provider_native_unconfirmed"
    assert diagnostics == {
        "pauseGapsApplied": 1,
        "pauseGapsAlreadyPreserved": 0,
        "wordsShiftedForPause": 0,
        "wordsClampedForPause": 3,
        "wordsRejectedForCrossingHardGap": 3,
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
    }
