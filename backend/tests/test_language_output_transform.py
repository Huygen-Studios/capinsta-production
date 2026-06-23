import pytest

import ai_pipeline.output_transform as output_transform
from ai_pipeline.language_modes import (
    normalize_audio_language,
    normalize_caption_output,
    transcription_language_mode,
)
from ai_pipeline.output_transform import transform_segments_for_output


def _segments(text="అమ్మ వచ్చింది"):
    return [
        {
            "id": "seg_0001",
            "start": 1.0,
            "end": 3.0,
            "text": text,
            "words": [
                {"word": "అమ్మ", "start": 1.0, "end": 1.7, "provider": "gemini", "timing_source": "provider_word"},
                {"word": "వచ్చింది", "start": 1.8, "end": 3.0, "provider": "gemini", "timing_source": "provider_word"},
            ],
        }
    ]


def test_legacy_tenglish_alias_normalizes_to_telgish():
    assert normalize_audio_language("tenglish") == "telgish"
    assert normalize_audio_language("teluglish") == "telgish"
    assert normalize_audio_language("te-en") == "telgish"
    assert normalize_caption_output("tenglish") == "telgish"


def test_audio_auto_uses_legacy_transcription_mode():
    assert normalize_audio_language("auto") == "auto"
    assert transcription_language_mode("auto") == "auto_mixed_indian"


def test_unsupported_audio_language_raises_validation_error():
    with pytest.raises(ValueError):
        normalize_audio_language("spanish")


def test_telugu_keep_original_preserves_provider_word_timestamps():
    transformed, report = transform_segments_for_output(
        _segments(),
        source_language="telugu",
        output_language="original",
    )

    assert report["transformation"] == "none"
    assert transformed[0]["text"] == "అమ్మ వచ్చింది"
    assert transformed[0]["words"][0]["start"] == 1.0
    assert transformed[0]["words"][0]["timing_source"] == "provider_word"


def test_telugu_to_telgish_preserves_one_to_one_timestamps():
    transformed, report = transform_segments_for_output(
        _segments(),
        source_language="telugu",
        output_language="telgish",
    )

    assert report["transformation"] == "transliteration"
    assert transformed[0]["text"] != "అమ్మ వచ్చింది"
    assert len(transformed[0]["words"]) == 2
    assert transformed[0]["words"][0]["start"] == 1.0
    assert transformed[0]["words"][0]["originalWord"] == "అమ్మ"


def test_translation_preserves_segment_boundaries_and_derives_monotonic_words(monkeypatch):
    monkeypatch.setattr(output_transform, "_translate_text", lambda text, source, output: "mother arrived today")
    transformed, report = transform_segments_for_output(
        _segments(),
        source_language="telugu",
        output_language="english",
    )

    words = transformed[0]["words"]
    assert report["transformation"] == "translation"
    assert transformed[0]["start"] == 1.0
    assert transformed[0]["end"] == 3.0
    assert transformed[0]["text"] == "mother arrived today"
    assert words[0]["start"] >= 1.0
    assert words[-1]["end"] <= 3.0
    assert all(words[index]["end"] <= words[index + 1]["start"] for index in range(len(words) - 1))
    assert all(word["timing_source"] == "translated_derived" for word in words)
