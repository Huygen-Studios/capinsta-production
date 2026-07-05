import pytest

from ai_pipeline.audio import Chunk
from ai_pipeline.aligner import align_text
from ai_pipeline.sync import stable_refine
from ai_pipeline.main import (
    _chunks_have_any_provider_words,
    _chunks_have_non_word_provider_timing,
    _chunks_have_provider_words,
)
from ai_pipeline.sync.aligned_words import build_segments_from_aligned_words
from ai_pipeline.audio import build_vad_chunk_ranges
from ai_pipeline.pipeline_config import DEFAULT_PIPELINE_OPTIONS, resolve_pipeline_config
from ai_pipeline.renderer import generate_srt, generate_vtt
from ai_pipeline.transcript_normalizer import (
    build_word_timed_transcript_from_chunks,
)
from server.transcription_control import TranscriptionConfigSnapshot, coerce_snapshot


def _chunk(words, *, basis="chunk_local"):
    chunk = Chunk(0, "unused.wav", 10.0, 15.0)
    chunk.final_text = "hello world"
    chunk.asr_metadata = {
        "provider": "openai",
        "timestamp_basis": basis,
        "words": words,
    }
    return chunk


def test_pipeline_config_defaults_are_production_safe(monkeypatch):
    for name in (
        "VAD_TARGET_SECONDS",
        "VAD_MAX_SECONDS",
        "CHUNK_PADDING_SECONDS",
        "ENABLE_STABLE_TS",
        "STABLE_TS_MODEL",
        "STABLE_TS_MIN_MATCH_COVERAGE",
        "STABLE_TS_MIN_WORD_RATIO",
        "STABLE_TS_MAX_WORD_RATIO",
        "MIN_MATCH_COVERAGE",
        "CAPTION_MAX_WORDS",
        "CAPTION_MAX_CHARS",
        "MAX_DURATION_SECONDS",
        "ALLOW_STABLE_TS_ORDER_FALLBACK",
        "ENABLE_SILERO_VAD",
        "SILERO_THRESHOLD",
        "SILERO_MIN_SPEECH_DURATION_MS",
        "SILERO_MIN_SILENCE_DURATION_MS",
        "SILERO_SPEECH_PAD_MS",
        "PROVIDER_TIMEOUT_SECONDS",
        "SARVAM_CONCURRENCY",
        "STABLE_TS_MAX_AUDIO_SECONDS",
        "ALLOW_ESTIMATED_WORDS",
        "MAXIMUM_ESTIMATED_WORD_RATIO",
    ):
        monkeypatch.delenv(name, raising=False)
    config = resolve_pipeline_config()
    assert config.timingSourcePolicy == "native_then_forced"
    assert config.quality.allowEstimatedWords is True
    assert config.quality.allowSegmentDerivedWords is False
    assert config.quality.maximumEstimatedWordRatio is None
    assert config.quality.minimumProviderTimestampCoverage == 0.90
    assert config.performance.providerTimeoutSeconds == 90
    assert config.performance.stableTsMaxAudioSeconds == 20.0
    assert config.captionChunking.maxWords == 3
    assert config.captionChunking.maxCharacters == 28
    assert config.audioChunking.targetSeconds == 8
    assert config.audioChunking.maxSeconds == 12
    assert config.audioChunking.paddingSeconds == 0.18
    assert config.alignment.stableTsModel == "small"
    assert config.alignment.allowStableTsOrderFallback is False
    assert config.to_dict() == DEFAULT_PIPELINE_OPTIONS


def test_pipeline_config_resolves_stable_ts_threshold_env_aliases(monkeypatch):
    monkeypatch.setenv("STABLE_TS_MIN_MATCH_COVERAGE", "0.62")
    monkeypatch.setenv("STABLE_TS_MIN_WORD_RATIO", "0.33")
    monkeypatch.setenv("STABLE_TS_MAX_WORD_RATIO", "1.75")
    monkeypatch.setenv("ALLOW_STABLE_TS_ORDER_FALLBACK", "false")

    config = resolve_pipeline_config()

    assert config.alignment.stableTsMinMatchCoverage == 0.62
    assert config.alignment.stableTsMinWordRatio == 0.33
    assert config.alignment.stableTsMaxWordRatio == 1.75
    assert config.alignment.allowStableTsOrderFallback is False


def test_pipeline_config_rejects_invalid_policy_and_ranges():
    with pytest.raises(ValueError):
        resolve_pipeline_config({"timingSourcePolicy": "interpolate_everything"})
    with pytest.raises(ValueError):
        resolve_pipeline_config({"quality": {"maximumEstimatedWordRatio": 4}})


def test_pipeline_config_parses_legacy_maximum_estimated_ratio_without_defaulting(monkeypatch):
    monkeypatch.setenv("MAXIMUM_ESTIMATED_WORD_RATIO", "0.5")

    config = resolve_pipeline_config()

    assert config.quality.maximumEstimatedWordRatio == 0.5


def test_snapshot_serializes_resolved_pipeline_options_without_loss():
    options = resolve_pipeline_config(
        {
            "timingSourcePolicy": "native_required",
            "performance": {"providerTimeoutSeconds": 45},
        }
    ).to_dict()
    snapshot = TranscriptionConfigSnapshot(
        configuration_id="cfg-1",
        provider="openai",
        model="whisper-1",
        version=7,
        provider_options={},
        timestamp_strategy="provider_word",
        pipeline_options=options,
        resolved_pipeline_options=options,
    )
    payload = snapshot.to_dict()
    parsed = coerce_snapshot(payload)
    assert parsed is not None
    assert parsed.resolved_pipeline_options["timingSourcePolicy"] == "native_required"
    assert parsed.resolved_pipeline_options["performance"]["providerTimeoutSeconds"] == 45


def test_stable_ts_max_audio_seconds_env_override(monkeypatch):
    monkeypatch.setenv("STABLE_TS_MAX_AUDIO_SECONDS", "30")

    config = resolve_pipeline_config()

    assert config.performance.stableTsMaxAudioSeconds == 30.0


def test_declared_chunk_local_native_words_are_preserved_for_english():
    chunk = _chunk(
        [
            {"word": "hello", "start": 0.2, "end": 0.5, "timing_source": "provider_native_word"},
            {"word": "world", "start": 0.7, "end": 1.0, "timing_source": "provider_native_word"},
        ]
    )
    segments = build_word_timed_transcript_from_chunks([chunk], "english")
    words = [word for segment in segments for word in segment["words"]]
    assert words[0]["start"] == 10.2
    assert words[1]["end"] == 11.0
    assert words[0]["timestampBasis"] == "chunk_local"


def test_declared_absolute_native_words_are_not_offset_again():
    chunk = _chunk(
        [
            {"word": "hello", "start": 10.2, "end": 10.5, "timing_source": "provider_native_word"},
            {"word": "world", "start": 10.7, "end": 11.0, "timing_source": "provider_native_word"},
        ],
        basis="absolute",
    )
    segments = build_word_timed_transcript_from_chunks([chunk], "english")
    words = [word for segment in segments for word in segment["words"]]
    assert words[0]["start"] == 10.2
    assert words[1]["end"] == 11.0
    assert words[0]["timestampBasis"] == "absolute"


def test_estimated_segment_derived_words_are_not_counted_as_native_but_can_generate():
    chunk = _chunk(
        [
            {"word": "hello world", "start": 0.0, "end": 2.0, "timing_source": "provider_segment_derived"},
        ]
    )
    assert _chunks_have_provider_words([chunk]) is False
    segments = build_word_timed_transcript_from_chunks([chunk], "english")
    words = [word for segment in segments for word in segment["words"]]
    assert [word["word"] for word in words] == ["hello", "world"]
    assert all(word["timingNeedsReview"] for word in words)


def test_preserved_phrase_timing_words_are_not_counted_as_native():
    chunk = _chunk(
        [
            {
                "word": "hello",
                "start": 0.0,
                "end": 2.0,
                "timing_source": "provider_native_word",
                "preservePhraseTiming": True,
            },
        ]
    )
    assert _chunks_have_provider_words([chunk]) is False
    assert _chunks_have_any_provider_words([chunk]) is True
    assert _chunks_have_non_word_provider_timing([chunk]) is True


def test_sarvam_phrase_timing_is_never_provider_word_timing_even_when_estimated_allowed():
    chunk = _chunk(
        [
            {
                "word": "okka roopaayiki asalu entha petrol vastundo",
                "start": 0.0,
                "end": 20.0,
                "timing_source": "provider_phrase",
                "timingSource": "provider_phrase",
                "preservePhraseTiming": True,
            },
        ]
    )
    chunk.asr_metadata.update(
        {
            "provider": "sarvam",
            "nativeWordsAvailable": False,
            "timing_granularity": "phrase",
            "phraseEntryCount": 1,
        }
    )
    config = resolve_pipeline_config(
        {
            "timingSourcePolicy": "native_then_forced",
            "quality": {
                "allowEstimatedWords": True,
                "maximumEstimatedWordRatio": 1.0,
            },
        }
    )

    has_provider_word_timing = _chunks_have_provider_words([chunk])
    has_any_provider_word_timing = _chunks_have_any_provider_words([chunk])
    has_non_word_provider_timing = _chunks_have_non_word_provider_timing([chunk])
    use_provider_word_timing = (
        config.timingSourcePolicy != "forced"
        and (
            has_provider_word_timing
            or (
                has_any_provider_word_timing
                and not has_non_word_provider_timing
                and config.timingSourcePolicy == "estimated_debug_only"
            )
        )
    )

    assert has_provider_word_timing is False
    assert has_any_provider_word_timing is True
    assert has_non_word_provider_timing is True
    assert use_provider_word_timing is False


def test_structured_model_timestamps_are_not_counted_as_native():
    chunk = _chunk(
        [
            {
                "word": "hello",
                "start": 0.0,
                "end": 0.4,
                "timing_source": "provider_structured_word",
            },
        ]
    )
    assert _chunks_have_provider_words([chunk]) is False
    assert _chunks_have_any_provider_words([chunk]) is True


def test_estimated_debug_policy_marks_estimated_words():
    chunk = _chunk(
        [
            {"word": "hello world", "start": 0.0, "end": 2.0, "timing_source": "provider_segment_derived"},
        ]
    )
    config = resolve_pipeline_config({"timingSourcePolicy": "estimated_debug_only"})
    segments = build_word_timed_transcript_from_chunks([chunk], "english", pipeline_config=config)
    words = [word for segment in segments for word in segment["words"]]
    assert len(words) == 2
    assert all(word["timingNeedsReview"] for word in words)


def _ten_word_chunk_with_one_estimated():
    words = []
    for index in range(10):
        words.append(
            {
                "word": f"word{index}",
                "start": index * 0.2,
                "end": index * 0.2 + 0.1,
                "timing_source": "estimated" if index == 0 else "provider_native_word",
            }
        )
    return _chunk(words)


def test_legacy_maximum_estimated_word_ratio_is_telemetry_only():
    config = resolve_pipeline_config(
        {
            "quality": {
                "allowEstimatedWords": True,
                "maximumEstimatedWordRatio": 0.0,
            }
        }
    )

    segments = build_word_timed_transcript_from_chunks(
        [_ten_word_chunk_with_one_estimated()],
        "english",
        pipeline_config=config,
    )
    words = [word for segment in segments for word in segment["words"]]

    assert len(words) == 10
    assert sum(1 for word in words if word.get("timingNeedsReview")) == 1


def test_legacy_allow_estimated_words_false_is_telemetry_only():
    config = resolve_pipeline_config(
        {
            "quality": {
                "allowEstimatedWords": False,
                "maximumEstimatedWordRatio": 0.0,
            }
        }
    )

    segments = build_word_timed_transcript_from_chunks(
        [_ten_word_chunk_with_one_estimated()],
        "english",
        pipeline_config=config,
    )
    words = [word for segment in segments for word in segment["words"]]

    assert len(words) == 10
    assert sum(1 for word in words if word.get("timingNeedsReview")) == 1


def test_hundred_percent_estimated_word_timing_generates_valid_english_captions():
    chunk = _chunk(
        [
            {
                "word": "all estimated words still render",
                "start": 0.0,
                "end": 2.0,
                "timing_source": "provider_segment_derived",
            }
        ]
    )
    config = resolve_pipeline_config(
        {
            "quality": {
                "allowEstimatedWords": True,
                "maximumEstimatedWordRatio": 0.0,
            }
        }
    )

    segments = build_word_timed_transcript_from_chunks([chunk], "english", pipeline_config=config)
    words = [word for segment in segments for word in segment["words"]]

    assert [word["word"] for word in words] == ["all", "estimated", "words", "still", "render"]
    assert all(word["timingNeedsReview"] for word in words)
    assert all(word["end"] > word["start"] for word in words)


def test_caption_chunking_rules_change_visible_output():
    words = [
        {"word": "one", "start": 0.0, "end": 0.2},
        {"word": "two", "start": 0.25, "end": 0.45},
        {"word": "three", "start": 0.5, "end": 0.7},
        {"word": "four", "start": 0.75, "end": 0.95},
    ]
    one_word = build_segments_from_aligned_words(
        words,
        chunking_rules={
            "target_words": 1,
            "max_words": 1,
            "min_words": 1,
            "max_chars": 20,
            "min_duration": 0.1,
            "max_duration": 3.0,
            "pause_split_threshold": 1.0,
            "merge_gap": 0.0,
            "phrase_hold": 0.0,
        },
    )
    four_words = build_segments_from_aligned_words(
        words,
        chunking_rules={
            "target_words": 4,
            "max_words": 4,
            "min_words": 1,
            "max_chars": 80,
            "min_duration": 0.1,
            "max_duration": 3.0,
            "pause_split_threshold": 1.0,
            "merge_gap": 0.1,
            "phrase_hold": 0.0,
        },
    )
    assert len(one_word) == 4
    assert len(four_words) == 1


def test_vad_chunk_parameters_change_chunk_boundaries():
    speech = [
        {"start": 0.0, "end": 4.0},
        {"start": 5.0, "end": 9.0},
        {"start": 10.0, "end": 14.0},
    ]

    short_chunks = build_vad_chunk_ranges(
        speech,
        20.0,
        target_seconds=4.0,
        max_seconds=6.0,
        padding_seconds=0.0,
    )
    long_chunks = build_vad_chunk_ranges(
        speech,
        20.0,
        target_seconds=20.0,
        max_seconds=25.0,
        padding_seconds=0.0,
    )

    assert len(short_chunks) > len(long_chunks)
    assert long_chunks == [(0.0, 14.0)]


def test_production_policy_does_not_accept_deterministic_forced_alignment_fallback():
    with pytest.raises(RuntimeError, match="Real forced alignment is unavailable"):
        align_text(
            [{"text": "hello world", "start": 0.0, "end": 1.0}],
            "missing.wav",
            "WAV2VEC2_ASR_BASE_960H",
            allow_fallback=False,
            enable_whisperx=False,
            provider="auto",
        )


def test_stable_ts_order_fallback_can_be_disabled(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: True)
    monkeypatch.setattr(
        stable_refine,
        "force_align_provider_words",
        lambda *_args, **_kwargs: [
            {"word": "uno", "start": 0.0, "end": 0.2},
            {"word": "dos", "start": 0.3, "end": 0.5},
        ],
    )

    result = stable_refine.apply_stable_refinement(
        [
            {
                "text": "one two",
                "start": 0.0,
                "end": 1.0,
                "words": [
                    {"word": "one", "start": 0.0, "end": 0.2},
                    {"word": "two", "start": 0.3, "end": 0.5},
                ],
            }
        ],
        "audio.wav",
        "english",
        config={
            "enabled": True,
            "allowOrderFallback": False,
            "minMatchCoverage": 0.9,
            "minWordRatio": 0.5,
            "maxWordRatio": 2.0,
        },
    )

    assert result.report["applied"] is False
    assert "token coverage 0.000 below threshold" in result.report["reason"]
    assert result.report["orderFallbackUsed"] is False


def test_stable_ts_transcribe_fallback_runs_when_forced_align_fails(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: True)
    monkeypatch.setattr(stable_refine, "_cache_dir_writable", lambda _path: True)

    def fail_forced_align(*_args, **_kwargs):
        raise RuntimeError("align_words failed for hindi input")

    monkeypatch.setattr(stable_refine, "force_align_provider_words", fail_forced_align)
    monkeypatch.setattr(
        stable_refine,
        "transcribe_stable_words",
        lambda *_args, **_kwargs: [
            {"word": "namaste", "start": 0.1, "end": 0.3},
            {"word": "dosto", "start": 0.35, "end": 0.7},
        ],
    )

    result = stable_refine.apply_stable_refinement(
        [
            {
                "text": "namaste dosto",
                "start": 0.0,
                "end": 1.0,
                "words": [
                    {"word": "namaste", "start": 0.0, "end": 0.2},
                    {"word": "dosto", "start": 0.25, "end": 0.5},
                ],
            }
        ],
        "audio.wav",
        "hindi",
        config={
            "enabled": True,
            "allowOrderFallback": False,
            "minMatchCoverage": 0.9,
            "minWordRatio": 0.5,
            "maxWordRatio": 2.0,
        },
    )

    assert result.report["applied"] is True
    assert result.report["mode"] == "transcribe"
    assert result.report["appliedWords"] == 2
    assert result.report["warnings"][0].startswith("forced_align_failed:RuntimeError")
    assert result.segments[0]["words"][0]["start"] == 0.1
    assert result.segments[0]["words"][0]["timingSource"] == "stable_ts_adjusted"


def test_stable_ts_matching_preserves_hindi_unicode_tokens():
    result = stable_refine.match_stable_words_to_provider_words(
        [
            {"word": "नमस्ते"},
            {"word": "दोस्तो"},
            {"word": "आज"},
        ],
        [
            {"word": "नमस्ते", "start": 0.1, "end": 0.3},
            {"word": "दोस्तो", "start": 0.35, "end": 0.7},
            {"word": "आज", "start": 0.75, "end": 0.9},
        ],
    )

    assert result["matchedWordCount"] == 3
    assert result["matchCoverage"] == 1.0


def test_stable_ts_matching_bridges_hindi_romanized_tokens():
    result = stable_refine.match_stable_words_to_provider_words(
        [
            {"word": "namaste"},
            {"word": "dosto"},
            {"word": "hai"},
        ],
        [
            {"word": "नमस्ते", "start": 0.1, "end": 0.3},
            {"word": "दोस्तो", "start": 0.35, "end": 0.7},
            {"word": "है", "start": 0.75, "end": 0.9},
        ],
    )

    assert result["matchedWordCount"] == 3
    assert result["matchCoverage"] == 1.0


def test_stable_ts_matching_bridges_telugu_romanized_code_switched_tokens():
    result = stable_refine.match_stable_words_to_provider_words(
        [
            {"spokenWord": "సందీప్", "displayedWord": "sandeep"},
            {"spokenWord": "బడ్జెట్", "displayedWord": "budget"},
            {"spokenWord": "plan", "displayedWord": "plan"},
        ],
        [
            {"word": "sandeep", "start": 0.1, "end": 0.3},
            {"word": "budget", "start": 0.35, "end": 0.6},
            {"word": "plan", "start": 0.65, "end": 0.9},
        ],
    )

    assert result["matchedWordCount"] == 3
    assert result["matchCoverage"] == 1.0


def test_stable_ts_does_not_order_fill_unmatched_words_after_good_token_match(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: True)
    monkeypatch.setattr(stable_refine, "_cache_dir_writable", lambda _path: True)
    monkeypatch.setattr(
        stable_refine,
        "force_align_provider_words",
        lambda *_args, **_kwargs: [
            {"word": "one", "start": 0.1, "end": 0.2},
            {"word": "two", "start": 0.25, "end": 0.35},
            {"word": "banana", "start": 0.4, "end": 0.5},
            {"word": "four", "start": 0.55, "end": 0.7},
        ],
    )

    result = stable_refine.apply_stable_refinement(
        [
            {
                "text": "one two three four",
                "start": 0.0,
                "end": 1.0,
                "words": [
                    {"word": "one", "start": 0.0, "end": 0.1, "timingSource": "deterministic_fallback"},
                    {"word": "two", "start": 0.1, "end": 0.2, "timingSource": "deterministic_fallback"},
                    {"word": "three", "start": 0.36, "end": 0.45, "timingSource": "deterministic_fallback"},
                    {"word": "four", "start": 0.5, "end": 0.6, "timingSource": "deterministic_fallback"},
                ],
            }
        ],
        "audio.wav",
        "hindi",
        config={
            "enabled": True,
            "allowOrderFallback": True,
            "minMatchCoverage": 0.5,
            "minWordRatio": 0.5,
            "maxWordRatio": 2.0,
        },
    )

    words = result.segments[0]["words"]
    assert result.report["applied"] is True
    assert result.report["appliedWords"] == 3
    assert result.report["orderFallbackUsed"] is False
    assert result.report["orderFallbackAppliedWords"] == 0
    assert words[2]["start"] == 0.36
    assert words[2]["timingSource"] == "deterministic_fallback"
    assert words[2]["timingQualityMode"] == "word_timed_estimated"
    assert {words[index]["timingSource"] for index in (0, 1, 3)} == {"stable_ts_forced_align"}


def test_stable_ts_low_global_coverage_recovers_from_provider_native_words(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: True)
    monkeypatch.setattr(stable_refine, "_cache_dir_writable", lambda _path: True)
    monkeypatch.setattr(
        stable_refine,
        "force_align_provider_words",
        lambda *_args, **_kwargs: [
            {"word": f"w{index}", "start": index * 0.1, "end": index * 0.1 + 0.05}
            for index in range(37)
        ],
    )
    provider_words = [
        {
            "word": f"w{index}",
            "start": index * 0.1,
            "end": index * 0.1 + 0.05,
            "nativeStart": index * 0.1,
            "nativeEnd": index * 0.1 + 0.05,
            "timingSource": "provider_native_word",
        }
        for index in range(100)
    ]

    result = stable_refine.apply_stable_refinement(
        [{"text": " ".join(word["word"] for word in provider_words), "start": 0.0, "end": 10.0, "words": provider_words}],
        "audio.wav",
        "english",
        config={"enabled": True, "minMatchCoverage": 0.5, "minWordRatio": 0.45, "maxWordRatio": 2.25},
    )

    assert result.report["matchCoverage"] == 0.37
    assert result.report["wordRatio"] == 0.37
    assert result.report["errorCategory"] is None
    assert result.report["finalTimingQualityMode"] == "word_timed_verified"
    assert result.report["verifiedWordCount"] == 100
    assert result.report["recoveryByGroup"]
    assert all(word["timingQualityMode"] == "word_timed_verified" for word in result.segments[0]["words"])


def test_stable_ts_accepts_successful_group_and_recovers_failed_group(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: True)
    monkeypatch.setattr(stable_refine, "_cache_dir_writable", lambda _path: True)
    monkeypatch.setattr(
        stable_refine,
        "force_align_provider_words",
        lambda *_args, **_kwargs: [
            {"word": "alpha", "start": 0.0, "end": 0.2},
            {"word": "bravo", "start": 0.25, "end": 0.45},
            {"word": "charlie", "start": 0.5, "end": 0.7},
        ],
    )

    result = stable_refine.apply_stable_refinement(
        [
            {
                "id": "good",
                "text": "alpha bravo charlie",
                "start": 0.0,
                "end": 1.0,
                "words": [
                    {"word": "alpha", "start": 0.0, "end": 0.15, "timingSource": "provider_word"},
                    {"word": "bravo", "start": 0.2, "end": 0.35, "timingSource": "provider_word"},
                    {"word": "charlie", "start": 0.4, "end": 0.55, "timingSource": "provider_word"},
                ],
            },
            {
                "id": "failed",
                "text": "delta echo foxtrot",
                "start": 1.2,
                "end": 2.2,
                "words": [
                    {"word": "delta", "start": 1.2, "end": 1.35, "timingSource": "provider_word", "nativeStart": 1.2, "nativeEnd": 1.35},
                    {"word": "echo", "start": 1.4, "end": 1.55, "timingSource": "provider_word", "nativeStart": 1.4, "nativeEnd": 1.55},
                    {"word": "foxtrot", "start": 1.6, "end": 1.75, "timingSource": "provider_word", "nativeStart": 1.6, "nativeEnd": 1.75},
                ],
            },
        ],
        "audio.wav",
        "english",
        config={"enabled": True, "minMatchCoverage": 0.5, "minWordRatio": 0.45, "maxWordRatio": 2.25},
    )

    assert result.report["applied"] is True
    assert result.report["failedGroupIds"]
    assert {word["timingSource"] for word in result.segments[0]["words"]} == {"stable_ts_forced_align"}
    assert all(word["timingQualityMode"] == "word_timed_verified" for word in result.segments[1]["words"])


def test_stable_ts_phrase_fallback_disables_active_word_highlighting(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: False)

    result = stable_refine.apply_stable_refinement(
        [{"id": "phrase", "text": "provider phrase only", "start": 0.4, "end": 1.8, "words": []}],
        "audio.wav",
        "english",
        config={"enabled": True},
    )

    assert result.report["finalTimingQualityMode"] == "phrase_timed_fallback"
    assert result.report["phraseFallbackCueCount"] == 1
    assert result.segments[0]["disableActiveWordHighlighting"] is True
    assert result.segments[0]["timingQualityMode"] == "phrase_timed_fallback"


def test_stable_ts_recovery_uses_vad_speech_range_when_segment_anchor_is_missing(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: False)

    result = stable_refine.apply_stable_refinement(
        [
            {
                "id": "vad-only",
                "text": "hello world",
                "words": [
                    {"word": "hello", "start": None, "end": None},
                    {"word": "world", "start": None, "end": None},
                ],
            }
        ],
        "audio.wav",
        "english",
        config={
            "enabled": True,
            "speechRanges": [{"start": 3.0, "end": 4.0}],
        },
    )

    words = result.segments[0]["words"]
    assert set(result.report["recoveryByGroup"].values()) == {"vad_speech_interpolation"}
    assert result.report["finalTimingQualityMode"] == "word_timed_estimated"
    assert words[0]["start"] == 3.0
    assert words[-1]["end"] == 4.0
    assert all(word["timingSource"] == "vad_speech_interpolation" for word in words)


def test_low_coverage_recovery_exports_valid_srt_and_vtt(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: True)
    monkeypatch.setattr(stable_refine, "_cache_dir_writable", lambda _path: True)
    monkeypatch.setattr(
        stable_refine,
        "force_align_provider_words",
        lambda *_args, **_kwargs: [
            {"word": f"w{index}", "start": index * 0.1, "end": index * 0.1 + 0.05}
            for index in range(37)
        ],
    )
    provider_words = [
        {
            "word": f"w{index}",
            "displayedWord": f"w{index}",
            "start": index * 0.1,
            "end": index * 0.1 + 0.05,
            "nativeStart": index * 0.1,
            "nativeEnd": index * 0.1 + 0.05,
            "timingSource": "provider_native_word",
        }
        for index in range(100)
    ]

    result = stable_refine.apply_stable_refinement(
        [{"text": " ".join(word["word"] for word in provider_words), "start": 0.0, "end": 10.0, "words": provider_words}],
        "audio.wav",
        "english",
        config={"enabled": True, "minMatchCoverage": 0.5, "minWordRatio": 0.45, "maxWordRatio": 2.25},
    )

    srt = generate_srt(result.segments)
    vtt = generate_vtt(result.segments)
    assert "WEBVTT" in vtt
    assert "00:00:00,000 -->" in srt
    assert "--> 00:00:10,000" in srt
    assert "00:00:00.000 -->" in vtt
    assert "--> 00:00:10.000" in vtt


def test_stable_ts_cache_not_writable_is_specific(monkeypatch, tmp_path):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: True)
    monkeypatch.setattr(stable_refine, "_cache_dir_writable", lambda _path: False)
    monkeypatch.setenv("STABLE_TS_CACHE_DIR", str(tmp_path / "stable-cache"))

    result = stable_refine.apply_stable_refinement(
        [
            {
                "text": "hello",
                "start": 0.0,
                "end": 1.0,
                "words": [{"word": "hello", "start": 0.0, "end": 0.5}],
            }
        ],
        "audio.wav",
        "english",
        config={"enabled": True},
    )

    assert result.report["applied"] is False
    assert result.report["errorCategory"] == "stable_ts_cache_not_writable"


def test_stable_ts_cpu_long_audio_guard_skips_before_model_call(monkeypatch):
    monkeypatch.setattr(stable_refine, "stable_ts_available", lambda: True)
    monkeypatch.setattr(stable_refine, "_cache_dir_writable", lambda _path: True)
    monkeypatch.setattr(stable_refine, "_resolve_device", lambda _device: "cpu")

    def should_not_run(*_args, **_kwargs):
        raise AssertionError("stable-ts model call should not run for over-limit CPU audio")

    monkeypatch.setattr(stable_refine, "force_align_provider_words", should_not_run)
    monkeypatch.setattr(stable_refine, "transcribe_stable_words", should_not_run)

    result = stable_refine.apply_stable_refinement(
        [
            {
                "text": "hello world",
                "start": 0.0,
                "end": 62.0,
                "words": [
                    {"word": "hello", "start": 0.0, "end": 0.4},
                    {"word": "world", "start": 0.5, "end": 1.0},
                ],
            }
        ],
        "audio.wav",
        "english",
        config={
            "enabled": True,
            "audioDurationSeconds": 62.0,
            "maxAudioSeconds": 45.0,
        },
    )

    assert result.report["applied"] is False
    assert result.report["errorCategory"] == "stable_ts_audio_too_long_for_cpu"
    assert result.report["audioDurationSeconds"] == 62.0
    assert result.report["maxAudioSeconds"] == 45.0
    assert "above 45.0s configured limit" in result.report["reason"]
