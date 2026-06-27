from ai_pipeline.sync.aligned_words import (
    build_segments_from_aligned_words,
    canonical_aligned_words_from_segments,
    sanitize_aligned_word_ranges,
)


def test_caption_blocks_are_rebuilt_from_aligned_words():
    source = [
        {
            "id": "old_wrong_block",
            "start": 8.0,
            "end": 14.0,
            "text": "old block",
            "words": [
                {"word": "next", "spokenWord": "next", "start": 11.0, "end": 11.2, "timingSource": "stable_ts_forced_align"},
                {"word": "next", "spokenWord": "next", "start": 11.25, "end": 11.45, "timingSource": "stable_ts_forced_align"},
                {"word": "hello", "spokenWord": "hello", "start": 13.0, "end": 13.2, "timingSource": "stable_ts_forced_align"},
            ],
        }
    ]
    words = canonical_aligned_words_from_segments(source)
    rebuilt = build_segments_from_aligned_words(words, chunking_rules={"target_words": 2, "max_words": 2, "min_words": 1})
    assert rebuilt[0]["start"] == 11.0
    assert "next" in rebuilt[0]["text"]
    assert rebuilt[0]["timingBasis"] == "alignedWords"


def test_estimated_words_are_marked_review_required():
    words = canonical_aligned_words_from_segments([
        {"words": [{"word": "hello", "start": 1.0, "end": 1.2, "timing_source": "provider_word_interpolated"}]}
    ])
    assert words[0]["timingNeedsReview"] is True


def test_invalid_stable_word_range_is_repaired_before_caption_build():
    segments = [
        {
            "words": [
                {"word": "okka", "start": 5.961, "end": 6.03, "timingSource": "stable_ts_forced_align"},
                {"word": "ramdi", "start": 6.031, "end": 5.961, "timingSource": "stable_ts_forced_align"},
                {"word": "roopaayiki", "start": 6.581, "end": 6.921, "timingSource": "stable_ts_forced_align"},
            ]
        }
    ]

    repaired, report = sanitize_aligned_word_ranges(segments)
    words = canonical_aligned_words_from_segments(repaired)
    rebuilt = build_segments_from_aligned_words(words, chunking_rules={"target_words": 3, "max_words": 3, "min_words": 1})

    assert report["repairedWords"] == 1
    assert words[1]["word"] == "ramdi"
    assert words[1]["end"] > words[1]["start"]
    assert words[1]["timingNeedsReview"] is True
    assert all(segment["end"] > segment["start"] for segment in rebuilt)


def test_sanitizer_trims_previous_word_instead_of_shifting_next_word():
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
                    "timingSource": "stable_ts_forced_align | pause_preserved",
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

    repaired, report = sanitize_aligned_word_ranges(segments)
    words = repaired[0]["words"]

    assert report["sameGroupOverlapCaps"] == 1
    assert words[0]["end"] == 17.445
    assert words[1]["start"] == 17.446
    assert words[1]["end"] == 17.486
    assert words[0]["timingRepairReason"] == "overlap_trimmed_before_next_word"


def test_sanitizer_leaves_exact_adjacent_words_unchanged():
    segments = [
        {
            "words": [
                {"word": "istaav", "start": 38.064, "end": 38.104, "alignmentGroupId": "ag-0027"},
                {"word": "ippudu", "start": 38.104, "end": 39.164, "alignmentGroupId": "ag-0027"},
            ]
        }
    ]

    repaired, report = sanitize_aligned_word_ranges(segments)
    words = repaired[0]["words"]

    assert report["sameGroupOverlapCaps"] == 0
    assert words[0]["start"] == 38.064
    assert words[0]["end"] == 38.104
    assert words[1]["start"] == 38.104
    assert words[1]["end"] == 39.164


def test_sanitizer_unrepairable_overlap_never_commits_zero_duration_word():
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
                },
                {
                    "word": "ippudu",
                    "start": 38.064,
                    "end": 38.496,
                    "alignmentGroupId": "ag-0027",
                    "sourceStart": 38.0,
                    "sourceEnd": 40.7,
                },
            ]
        }
    ]

    repaired, report = sanitize_aligned_word_ranges(segments)
    words = repaired[0]["words"]

    assert report["sameGroupOverlapCaps"] == 0
    assert report["sameGroupOverlapUnrepairable"] == 1
    assert words[0]["start"] == 38.064
    assert words[0]["end"] == 38.104
    assert words[0]["end"] > words[0]["start"]
    assert words[1]["start"] == 38.064
    assert words[1]["end"] == 38.496
