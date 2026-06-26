from ai_pipeline.pipeline_config import resolve_pipeline_config, resolve_pipeline_config_with_sources
from ai_pipeline.renderer import chunk_words_into_captions
from ai_pipeline.sync import stable_refine
from ai_pipeline.sync.aligned_words import (
    assign_alignment_groups_from_speech_gaps,
    build_segments_from_aligned_words,
    canonical_aligned_words_from_segments,
    sanitize_aligned_word_ranges,
)
from ai_pipeline.sync.pause_preserver import preserve_detected_pauses
from ai_pipeline.timing import _pad_speech_ranges, _speech_ranges_to_gaps


def _turn_segments():
    return [
        {
            "text": "anna roopaayiki petrol kottu raadaa",
            "start": 14.643,
            "end": 16.057,
            "alignmentGroupId": "turn-a",
            "sourceStart": 14.643,
            "sourceEnd": 16.057,
            "words": [
                {"word": "anna", "start": 14.643, "end": 15.246},
                {"word": "roopaayiki", "start": 15.246, "end": 15.286},
                {"word": "petrol", "start": 15.286, "end": 15.889},
                {"word": "kottu", "start": 15.889, "end": 15.929},
                {"word": "raadaa", "start": 15.929, "end": 16.057},
            ],
        },
        {
            "text": "raadu roopaayiki",
            "start": 16.509,
            "end": 16.787,
            "alignmentGroupId": "turn-b",
            "sourceStart": 16.509,
            "sourceEnd": 16.787,
            "words": [
                {"word": "raadu", "start": 16.509, "end": 16.689},
                {"word": "roopaayiki", "start": 16.689, "end": 16.787},
            ],
        },
    ]


def test_cross_boundary_fallback_rejects_next_turn_timing(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: True)
    monkeypatch.setattr(stable_refine, "_cache_dir_writable", lambda _path: True)
    monkeypatch.setattr(
        stable_refine,
        "force_align_provider_words",
        lambda *_args, **_kwargs: [
            {"word": "anna", "start": 14.65, "end": 15.0},
            {"word": "roopaayiki", "start": 15.05, "end": 15.2},
            {"word": "petrol", "start": 15.3, "end": 15.7},
            {"word": "kottu", "start": 15.8, "end": 15.93},
            {"word": "raadaa", "start": 16.52, "end": 16.6},
            {"word": "raadu", "start": 16.61, "end": 16.7},
            {"word": "roopaayiki", "start": 16.7, "end": 16.78},
        ],
    )

    result = stable_refine.apply_stable_refinement(
        _turn_segments(),
        "audio.wav",
        "telgish",
        config={"enabled": True, "allowOrderFallback": True, "minMatchCoverage": 0.2},
    )

    words_a = result.segments[0]["words"]
    words_b = result.segments[1]["words"]
    assert all(word["start"] < 16.509 for word in words_a)
    assert all(word["end"] <= 16.057 for word in words_a)
    assert all(word["start"] >= 16.509 for word in words_b)
    assert words_b[0]["word"] == "raadu"
    captions = build_segments_from_aligned_words(
        canonical_aligned_words_from_segments(result.segments),
        chunking_rules={"target_words": 3, "max_words": 3, "min_words": 1, "pause_split_threshold": 1, "phrase_hold": 0},
    )
    assert not any("kottu raadu" in caption["text"] for caption in captions)
    assert words_b[-1]["end"] > words_b[0]["start"]


def test_reverse_crossover_is_rejected(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: True)
    monkeypatch.setattr(stable_refine, "_cache_dir_writable", lambda _path: True)
    monkeypatch.setattr(
        stable_refine,
        "force_align_provider_words",
        lambda *_args, **_kwargs: [
            {"word": "raadu", "start": 15.9, "end": 16.0},
            {"word": "anna", "start": 14.65, "end": 15.0},
        ],
    )

    result = stable_refine.apply_stable_refinement(
        _turn_segments(),
        "audio.wav",
        "telgish",
        config={"enabled": True, "allowOrderFallback": True, "minMatchCoverage": 0.0},
    )

    assert result.segments[1]["words"][0]["start"] >= 16.509


def test_repeated_word_cannot_match_previous_group(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: True)
    monkeypatch.setattr(stable_refine, "_cache_dir_writable", lambda _path: True)
    monkeypatch.setattr(
        stable_refine,
        "force_align_provider_words",
        lambda *_args, **_kwargs: [
            {"word": "roopaayiki", "start": 15.2, "end": 15.35},
            {"word": "roopaayiki", "start": 16.7, "end": 16.78},
        ],
    )

    result = stable_refine.apply_stable_refinement(
        _turn_segments(),
        "audio.wav",
        "telgish",
        config={"enabled": True, "allowOrderFallback": True, "minMatchCoverage": 0.0},
    )

    assert result.segments[1]["words"][1]["start"] >= 16.509


def test_invalid_ramdi_range_repairs_locally_without_spill():
    segments = [
        {
            "alignmentGroupId": "turn-a",
            "sourceStart": 5.9,
            "sourceEnd": 6.2,
            "words": [
                {"word": "okka", "start": 5.961, "end": 6.03, "alignmentGroupId": "turn-a"},
                {
                    "word": "ramdi",
                    "spokenWord": "ramdi",
                    "displayedWord": "randi",
                    "start": 6.031,
                    "end": 5.961,
                    "alignmentGroupId": "turn-a",
                    "sourceStart": 5.9,
                    "sourceEnd": 6.2,
                },
            ],
        },
        {
            "alignmentGroupId": "turn-b",
            "sourceStart": 6.5,
            "sourceEnd": 6.9,
            "words": [{"word": "roopaayiki", "start": 6.581, "end": 6.821, "alignmentGroupId": "turn-b"}],
        },
    ]

    repaired, _report = sanitize_aligned_word_ranges(segments)
    words = canonical_aligned_words_from_segments(repaired)
    ramdi = next(word for word in words if word["spokenWord"] == "ramdi")
    assert ramdi["displayedWord"] == "randi"
    assert ramdi["end"] > ramdi["start"]
    assert ramdi["end"] <= 6.2
    assert repaired[1]["words"][0]["start"] == 6.581


def test_environment_preset_and_snapshot_precedence(monkeypatch):
    monkeypatch.setenv("VAD_TARGET_SECONDS", "8")
    monkeypatch.setenv("VAD_MAX_SECONDS", "12")
    monkeypatch.setenv("CHUNK_PADDING_SECONDS", "0.18")
    monkeypatch.setenv("ENABLE_STABLE_TS", "true")
    monkeypatch.setenv("STABLE_TS_MODEL", "small")
    monkeypatch.setenv("CAPTION_MAX_WORDS", "3")
    monkeypatch.setenv("CAPTION_MAX_CHARS", "28")
    monkeypatch.setenv("MAX_DURATION_SECONDS", "2")
    monkeypatch.setenv("ALLOW_STABLE_TS_ORDER_FALLBACK", "false")

    config = resolve_pipeline_config()
    assert config.audioChunking.targetSeconds == 8
    assert config.audioChunking.maxSeconds == 12
    assert config.audioChunking.paddingSeconds == 0.18
    assert config.alignment.stableTsModel == "small"
    assert config.captionChunking.maxWords == 3
    assert config.captionChunking.maxCharacters == 28
    assert config.captionChunking.maxDurationSeconds == 2
    assert config.alignment.allowStableTsOrderFallback is False

    override = resolve_pipeline_config({"captionChunking": {"maxWords": 2}})
    assert override.captionChunking.maxWords == 2
    inspected = resolve_pipeline_config_with_sources({"captionChunking": {"maxWords": 2}})
    assert inspected["sources"]["captionChunking"]["maxWords"] == "snapshot"
    assert inspected["sources"]["captionChunking"]["maxCharacters"] == "environment"


def test_caption_max_words_three_is_enforced():
    words = [
        {"word": f"word{i}", "start": i * 0.2, "end": i * 0.2 + 0.1}
        for i in range(8)
    ]
    captions = chunk_words_into_captions(
        words,
        {"target_words": 4, "max_words": 3, "min_words": 1, "max_chars": 200, "max_duration": 10, "pause_split_threshold": 10, "phrase_hold": 0},
    )
    assert captions
    assert all(len(caption["words"]) <= 3 for caption in captions)


def test_raw_vad_speech_gap_beats_music_energy_and_creates_hard_gap():
    raw_speech = [
        {"start": 0.0, "end": 1.0, "confidence": 0.9},
        {"start": 1.25, "end": 2.0, "confidence": 0.9},
    ]

    gaps = _speech_ranges_to_gaps(raw_speech, duration=2.0, min_silence=0.25)

    assert gaps == [{"start": 1.0, "end": 1.25, "duration": 0.25}]


def test_vad_padding_does_not_erase_raw_hard_pause():
    raw_speech = [
        {"start": 0.0, "end": 1.0},
        {"start": 1.25, "end": 2.0},
    ]

    padded = _pad_speech_ranges(raw_speech, duration=2.0, padding_seconds=0.18)
    raw_gaps = _speech_ranges_to_gaps(raw_speech, duration=2.0, min_silence=0.25)
    padded_gaps = _speech_ranges_to_gaps(padded, duration=2.0, min_silence=0.25)

    assert raw_gaps
    assert padded_gaps == []


def test_speech_gap_assigns_language_neutral_alignment_groups():
    segments = [
        {
            "words": [
                {"word": "I", "start": 0.0, "end": 0.2},
                {"word": "go", "start": 0.3, "end": 0.6},
                {"word": "No", "start": 0.9, "end": 1.05},
            ]
        }
    ]

    grouped, report = assign_alignment_groups_from_speech_gaps(
        segments,
        [{"start": 0.6, "end": 0.9, "duration": 0.3}],
        pause_threshold=0.25,
    )

    words = grouped[0]["words"]
    assert words[0]["alignmentGroupId"] == words[1]["alignmentGroupId"]
    assert words[2]["alignmentGroupId"] != words[1]["alignmentGroupId"]
    assert words[1]["hardBoundaryAfter"] is True
    assert words[2]["hardBoundaryBefore"] is True
    assert report["boundariesFromRawSpeechGaps"] == 1


def test_pause_preserver_repairs_crossing_word_locally_without_shifting_later_group():
    segments = [
        {
            "words": [
                {"word": "before", "start": 0.4, "end": 0.95, "alignmentGroupId": "a", "sourceStart": 0.0, "sourceEnd": 0.7},
                {"word": "after", "start": 1.05, "end": 1.2, "alignmentGroupId": "b", "sourceStart": 1.0, "sourceEnd": 1.4},
            ]
        }
    ]

    diagnostics = {}
    repaired = preserve_detected_pauses(
        segments,
        [{"start": 0.7, "end": 1.0, "duration": 0.3}],
        0.25,
        diagnostics=diagnostics,
    )

    words = repaired[0]["words"]
    assert words[0]["end"] <= 0.7
    assert words[0]["timingNeedsReview"] is True
    assert words[1]["start"] == 1.05
    assert diagnostics["wordsShiftedForPause"] == 0
    assert diagnostics["wordsRejectedForCrossingHardGap"] == 1


def test_caption_chunks_never_cross_hard_alignment_group_even_for_short_reply():
    words = [
        {"word": "tum", "start": 0.0, "end": 0.2, "alignmentGroupId": "a"},
        {"word": "jaana", "start": 0.25, "end": 0.5, "alignmentGroupId": "a", "hardBoundaryAfter": True},
        {"word": "nahi", "start": 0.8, "end": 1.0, "alignmentGroupId": "b", "hardBoundaryBefore": True},
    ]

    captions = chunk_words_into_captions(
        words,
        {"max_words": 3, "min_words": 1, "max_chars": 200, "pause_split_threshold": 10, "phrase_hold": 0.5},
    )

    assert len(captions) == 2
    assert captions[0]["text"] == "tum jaana"
    assert captions[1]["text"] == "nahi"


def test_silero_env_defaults_are_resolved_and_snapshot_can_override(monkeypatch):
    monkeypatch.setenv("ENABLE_SILERO_VAD", "true")
    monkeypatch.setenv("SILERO_THRESHOLD", "0.45")
    monkeypatch.setenv("SILERO_MIN_SPEECH_DURATION_MS", "90")
    monkeypatch.setenv("SILERO_MIN_SILENCE_DURATION_MS", "220")
    monkeypatch.setenv("SILERO_SPEECH_PAD_MS", "25")

    config = resolve_pipeline_config()
    assert config.vad.sileroEnabled is True
    assert config.vad.sileroSpeechThreshold == 0.45
    assert config.vad.sileroMinSpeechDurationMs == 90
    assert config.vad.sileroMinSilenceDurationMs == 220
    assert config.vad.sileroSpeechPadMs == 25

    inspected = resolve_pipeline_config_with_sources({"vad": {"sileroSpeechPadMs": 10}})
    assert inspected["resolved"]["vad"]["sileroSpeechPadMs"] == 10
    assert inspected["sources"]["vad"]["sileroSpeechPadMs"] == "snapshot"
