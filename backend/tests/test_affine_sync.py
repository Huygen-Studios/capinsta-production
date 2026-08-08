from ai_pipeline.sync.affine import retime_segments, validate_monotonic_word_timing


def _segments():
    return [
        {
            "start": 0.5,
            "end": 1.5,
            "text": "hello world",
            "words": [
                {"word": "hello", "start": 0.5, "end": 0.9},
                {"word": "world", "start": 0.95, "end": 1.5},
            ],
        }
    ]


def test_offset_shifts_words():
    result = retime_segments(_segments(), shift_seconds=0.2)
    assert result.segments[0]["words"][0]["start"] == 0.7
    assert result.segments[0]["end"] == 1.7


def test_skew_changes_duration_around_anchor():
    result = retime_segments(_segments(), skew=2.0, anchor_seconds=0.5)
    assert result.segments[0]["start"] == 0.5
    assert result.segments[0]["end"] == 2.5


def test_selected_range_only_retimes_matching_segment():
    segments = _segments() + [{"start": 3.0, "end": 4.0, "text": "later", "words": [{"word": "later", "start": 3.0, "end": 4.0}]}]
    result = retime_segments(segments, shift_seconds=0.1, start_range=0.0, end_range=2.0)
    assert result.segments[0]["start"] == 0.6
    assert result.segments[1]["start"] == 3.0


def test_no_negative_or_non_monotonic_timestamps():
    result = retime_segments(_segments(), shift_seconds=-2.0)
    assert result.segments[0]["start"] >= 0
    validation = validate_monotonic_word_timing(result.segments)
    assert validation["repairs"] >= 0
