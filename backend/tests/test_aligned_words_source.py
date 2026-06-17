from ai_pipeline.sync.aligned_words import build_segments_from_aligned_words, canonical_aligned_words_from_segments


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
