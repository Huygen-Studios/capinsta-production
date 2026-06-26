from pathlib import Path

from ai_pipeline.pipeline_config import resolve_pipeline_config_with_sources
from ai_pipeline.tools.timing_reference_evaluator import (
    compare_to_reference,
    parse_srt,
    renderer_manifest_from_segments,
)


def _write_srt(tmp_path: Path, cue_a: str, cue_b: str) -> Path:
    path = tmp_path / "reference.srt"
    path.write_text(
        f"""1
00:00:14,643 --> 00:00:16,057
{cue_a}

2
00:00:16,509 --> 00:00:16,787
{cue_b}
""",
        encoding="utf-8",
    )
    return path


def _word(text: str, start: float, end: float, group: str, segment: int, index: int):
    return {
        "spokenWord": text,
        "displayedWord": text,
        "word": text,
        "start": start,
        "end": end,
        "timingSource": "stable_ts_forced",
        "alignmentGroupId": group,
        "sourceStart": 14.643 if group == "a" else 16.509,
        "sourceEnd": 16.057 if group == "a" else 16.787,
        "segmentIndex": segment,
        "wordIndex": index,
        "captionBlockId": f"cap-{segment}",
    }


def _comparison(tmp_path: Path, cue_a: str, cue_b: str, segments, *, max_words=3):
    cues = parse_srt(_write_srt(tmp_path, cue_a, cue_b))
    words = [word for segment in segments for word in segment["words"]]
    resolved = resolve_pipeline_config_with_sources({"captionChunking": {"maxWords": max_words}})
    return compare_to_reference(cues, words, renderer_manifest_from_segments(segments), resolved)


def test_prior_cue_spill_fails_evaluation(tmp_path):
    segments = [
        {"id": "cap-0", "text": "I told you not to go", "start": 14.7, "end": 16.7, "words": [
            _word("I", 14.7, 14.8, "a", 0, 0),
            _word("told", 14.8, 15.0, "a", 0, 1),
            _word("you", 15.0, 15.2, "a", 0, 2),
            _word("go", 15.8, 16.7, "a", 0, 3),
        ]},
        {"id": "cap-1", "text": "No I did not", "start": 16.55, "end": 16.78, "words": [_word("No", 16.55, 16.6, "b", 1, 0)]},
    ]
    result = _comparison(tmp_path, "I told you not to go", "No I did not", segments, max_words=6)
    assert any(failure["type"] == "previous_cue_spill" for failure in result["failures"])


def test_next_cue_too_early_fails_evaluation(tmp_path):
    segments = [
        {"id": "cap-0", "text": "tum wahan mat jaana", "start": 14.7, "end": 16.0, "words": [_word("tum", 14.7, 14.8, "a", 0, 0)]},
        {"id": "cap-1", "text": "nahi jaaunga", "start": 16.0, "end": 16.78, "words": [_word("nahi", 16.0, 16.1, "b", 1, 0), _word("jaaunga", 16.6, 16.75, "b", 1, 1)]},
    ]
    result = _comparison(tmp_path, "tum wahan mat jaana", "nahi jaaunga", segments)
    assert any(failure["type"] == "next_cue_too_early" for failure in result["failures"])


def test_next_cue_too_late_fails_evaluation(tmp_path):
    segments = [
        {"id": "cap-0", "text": "anna roopaayiki petrol kottu raadaa", "start": 14.7, "end": 16.0, "words": [_word("anna", 14.7, 14.8, "a", 0, 0)]},
        {"id": "cap-1", "text": "raadu roopaayiki", "start": 17.2, "end": 17.5, "words": [_word("raadu", 17.2, 17.3, "b", 1, 0), _word("roopaayiki", 17.35, 17.5, "b", 1, 1)]},
    ]
    result = _comparison(tmp_path, "anna roopaayiki petrol kottu raadaa", "raadu roopaayiki", segments)
    assert any(failure["type"] == "next_cue_too_late" for failure in result["failures"])


def test_caption_group_spanning_hard_boundary_fails(tmp_path):
    segments = [
        {"id": "cap-0", "text": "go No", "start": 15.8, "end": 16.6, "words": [
            _word("go", 15.8, 16.0, "a", 0, 0),
            _word("No", 16.55, 16.6, "b", 0, 1),
        ]},
    ]
    result = _comparison(tmp_path, "I told you not to go", "No I did not", segments)
    assert any(failure["type"] == "caption_crosses_reference_cues" for failure in result["failures"])


def test_correctly_separated_groups_pass(tmp_path):
    segments = [
        {"id": "cap-0", "text": "yes yes go", "start": 14.7, "end": 16.0, "words": [
            _word("yes", 14.7, 14.8, "a", 0, 0),
            _word("yes", 14.9, 15.0, "a", 0, 1),
            _word("go", 15.5, 16.0, "a", 0, 2),
        ]},
        {"id": "cap-1", "text": "yes wait", "start": 16.55, "end": 16.78, "words": [
            _word("yes", 16.55, 16.62, "b", 1, 0),
            _word("wait", 16.64, 16.78, "b", 1, 1),
        ]},
    ]
    result = _comparison(tmp_path, "yes yes go", "yes wait", segments)
    assert result["passed"] is True


def test_snapshot_override_source_is_reported(monkeypatch):
    monkeypatch.setenv("CAPTION_MAX_WORDS", "3")
    result = resolve_pipeline_config_with_sources({"captionChunking": {"maxWords": 2}})
    assert result["resolved"]["captionChunking"]["maxWords"] == 2
    assert result["sources"]["captionChunking"]["maxWords"] == "snapshot"


def test_caption_max_words_four_or_more_fails(tmp_path):
    segments = [
        {"id": "cap-0", "text": "one two three four", "start": 14.7, "end": 15.8, "words": [
            _word("one", 14.7, 14.8, "a", 0, 0),
            _word("two", 14.9, 15.0, "a", 0, 1),
            _word("three", 15.1, 15.2, "a", 0, 2),
            _word("four", 15.3, 15.4, "a", 0, 3),
        ]},
        {"id": "cap-1", "text": "five", "start": 16.55, "end": 16.7, "words": [_word("five", 16.55, 16.7, "b", 1, 0)]},
    ]
    result = _comparison(tmp_path, "one two three four", "five", segments, max_words=3)
    assert any(failure["type"] == "caption_max_words_exceeded" for failure in result["failures"])


def test_code_switched_structural_boundary_passes(tmp_path):
    segments = [
        {"id": "cap-0", "text": "anna petrol mat po", "start": 14.7, "end": 16.0, "words": [
            _word("anna", 14.7, 14.8, "a", 0, 0),
            _word("petrol", 14.9, 15.0, "a", 0, 1),
            _word("mat", 15.1, 15.2, "a", 0, 2),
        ]},
        {"id": "cap-1", "text": "okay wait", "start": 16.55, "end": 16.78, "words": [
            _word("okay", 16.55, 16.62, "b", 1, 0),
            _word("wait", 16.64, 16.78, "b", 1, 1),
        ]},
    ]
    result = _comparison(tmp_path, "anna petrol mat po", "okay wait", segments)
    assert result["passed"] is True
