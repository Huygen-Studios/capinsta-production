import json
from pathlib import Path

from ai_pipeline.pipeline_config import resolve_pipeline_config_with_sources
from ai_pipeline.tools import evaluate_timing_reference
from ai_pipeline.tools.evaluate_timing_reference import _configured_provider_secrets_available
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
    assert any(failure["type"] == "caption_crosses_hard_reference_boundary" for failure in result["failures"])


def test_caption_group_spanning_soft_srt_line_wrap_does_not_fail(tmp_path):
    path = tmp_path / "reference.srt"
    path.write_text(
        """1
00:00:00,000 --> 00:00:00,600
hello

2
00:00:00,650 --> 00:00:01,200
world
""",
        encoding="utf-8",
    )
    cues = parse_srt(path)
    segments = [
        {
            "id": "cap-0",
            "text": "hello world",
            "start": 0.1,
            "end": 1.0,
            "words": [
                _word("hello", 0.1, 0.4, "a", 0, 0),
                _word("world", 0.7, 1.0, "a", 0, 1),
            ],
        }
    ]
    words = [word for segment in segments for word in segment["words"]]
    resolved = resolve_pipeline_config_with_sources({"captionChunking": {"maxWords": 3, "pauseSplitThresholdSeconds": 0.25}})

    result = compare_to_reference(cues, words, renderer_manifest_from_segments(segments), resolved)

    assert not any(failure["type"] == "caption_crosses_hard_reference_boundary" for failure in result["failures"])


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


def test_unmatched_reference_cue_is_diagnostic_not_timing_failure(tmp_path):
    segments = [
        {"id": "cap-0", "text": "hello", "start": 14.7, "end": 15.0, "words": [_word("hello", 14.7, 15.0, "a", 0, 0)]},
    ]

    result = _comparison(tmp_path, "hello", "unmatched reference words", segments)

    assert not any(failure["type"] == "next_cue_no_positive_visible_duration" for failure in result["failures"])
    boundary = next(item for item in result["boundaries"] if item["nextCueIndex"] == 1)
    assert boundary["nextMatchedWordCount"] == 0
    assert boundary["nextCueUnmatchedReference"] is True


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


def test_evaluator_preflight_expands_auto_provider_order(monkeypatch):
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("STT_PROVIDER_ORDER", "sarvam,gemini,openai_whisper")
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    available, missing = _configured_provider_secrets_available()

    assert available is True
    assert missing == []


def test_evaluator_preflight_reports_missing_auto_provider_secrets(monkeypatch):
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("STT_PROVIDER_ORDER", "sarvam,gemini")
    monkeypatch.delenv("SARVAM_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    available, missing = _configured_provider_secrets_available()

    assert available is False
    assert missing == ["GEMINI_API_KEY", "GOOGLE_API_KEY", "SARVAM_API_KEY"]


def test_evaluator_preserves_pipeline_artifacts_on_quality_failure(tmp_path, monkeypatch):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"fake")
    reference = _write_srt(tmp_path, "hello world", "next phrase")
    output_dir = tmp_path / "out"
    monkeypatch.setenv("STT_PROVIDER", "sarvam")
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")

    def fake_run_pipeline(*_args, **_kwargs):
        segments = [
            {
                "id": "cap-1",
                "text": "hello",
                "start": 14.7,
                "end": 15.0,
                "words": [
                    {
                        "spokenWord": "hello",
                        "displayedWord": "hello",
                        "word": "hello",
                        "start": 14.7,
                        "end": 15.0,
                        "timingSource": "deterministic_fallback",
                        "alignmentGroupId": "ag-1",
                        "sourceSegmentIndex": 0,
                        "sourceChunkIndex": 0,
                        "sourceStart": 14.6,
                        "sourceEnd": 15.2,
                    }
                ],
            }
        ]
        return {
            "status": "error",
            "code": "invalid_word_ranges",
            "message": "invalid_word_ranges: failed",
            "segments": segments,
            "transcript": {"segments": segments, "alignedWords": segments[0]["words"]},
            "finalTimingQuality": {"passed": False, "estimatedWordRatio": 1.0},
        }

    monkeypatch.setattr("ai_pipeline.main.run_pipeline", fake_run_pipeline)

    exit_code = evaluate_timing_reference.main(
        [
            "--input-video",
            str(video),
            "--reference-srt",
            str(reference),
            "--language-mode",
            "telgish",
            "--output-dir",
            str(output_dir),
        ]
    )

    assert exit_code == 2
    words = json.loads((output_dir / "pipeline_words.json").read_text(encoding="utf-8"))
    manifest = json.loads((output_dir / "renderer_timing_manifest.json").read_text(encoding="utf-8"))
    comparison = json.loads((output_dir / "reference_comparison.json").read_text(encoding="utf-8"))
    assert words[0]["word"] == "hello"
    assert manifest["captionGroups"][0]["text"] == "hello"
    assert comparison["finalTimingQuality"]["estimatedWordRatio"] == 1.0
