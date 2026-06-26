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
from ai_pipeline.transcript_normalizer import (
    TranscriptValidationError,
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


def test_pipeline_config_defaults_are_production_safe():
    config = resolve_pipeline_config()
    assert config.timingSourcePolicy == "native_then_forced"
    assert config.quality.allowEstimatedWords is False
    assert config.quality.allowSegmentDerivedWords is False
    assert config.quality.maximumEstimatedWordRatio == 0.15
    assert config.quality.minimumProviderTimestampCoverage == 0.90
    assert config.performance.providerTimeoutSeconds == 60
    assert config.captionChunking.maxWords == 5
    assert config.to_dict() == DEFAULT_PIPELINE_OPTIONS


def test_pipeline_config_rejects_invalid_policy_and_ranges():
    with pytest.raises(ValueError):
        resolve_pipeline_config({"timingSourcePolicy": "interpolate_everything"})
    with pytest.raises(ValueError):
        resolve_pipeline_config({"quality": {"maximumEstimatedWordRatio": 4}})


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


def test_estimated_segment_derived_words_are_not_counted_as_native():
    chunk = _chunk(
        [
            {"word": "hello world", "start": 0.0, "end": 2.0, "timing_source": "provider_segment_derived"},
        ]
    )
    assert _chunks_have_provider_words([chunk]) is False
    with pytest.raises(TranscriptValidationError):
        build_word_timed_transcript_from_chunks([chunk], "english")


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


def test_maximum_estimated_word_ratio_allows_ten_percent_when_configured():
    config = resolve_pipeline_config(
        {
            "quality": {
                "allowEstimatedWords": True,
                "maximumEstimatedWordRatio": 0.15,
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


def test_maximum_estimated_word_ratio_rejects_ten_percent_when_configured_too_low():
    config = resolve_pipeline_config(
        {
            "quality": {
                "allowEstimatedWords": True,
                "maximumEstimatedWordRatio": 0.05,
            }
        }
    )

    with pytest.raises(TranscriptValidationError) as exc:
        build_word_timed_transcript_from_chunks(
            [_ten_word_chunk_with_one_estimated()],
            "english",
            pipeline_config=config,
        )

    assert "Estimated word timing ratio 10.0% exceeds configured maximum 5%" in str(exc.value)


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
            "merge_gap": 0.0,
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
    assert "order fallback is disabled" in result.report["reason"]


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
