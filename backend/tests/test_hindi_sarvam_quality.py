import unicodedata

from ai_pipeline.language_modes import (
    normalize_caption_text,
    romanizeHindiText,
)
from ai_pipeline.output_transform import transform_segments_for_output
from ai_pipeline.transcriber import resolve_sarvam_request_options


def _segment(text):
    return [
        {
            "id": "segment-1",
            "start": 0.0,
            "end": 2.0,
            "text": text,
            "words": [
                {
                    "word": token,
                    "start": index * 0.5,
                    "end": (index + 1) * 0.5,
                    "provider": "sarvam",
                }
                for index, token in enumerate(text.split())
            ],
        }
    ]


def test_native_hindi_requests_native_sarvam_output_and_preserves_devanagari():
    assert resolve_sarvam_request_options("hindi", "original") == {
        "mode": "transcribe",
        "language_code": "hi-IN",
    }
    text = "नमस्ते, दुनिया!"
    assert normalize_caption_text(text, "hindi") == text


def test_hinglish_requests_provider_transliteration_and_is_not_transliterated_twice():
    assert resolve_sarvam_request_options("hindi", "hinglish") == {
        "mode": "translit",
        "language_code": "hi-IN",
    }
    provider_text = "Mera phone number hai 9840950950."
    transformed, report = transform_segments_for_output(
        _segment(provider_text),
        source_language="hindi",
        output_language="hinglish",
        provider_mode="translit",
    )
    assert transformed[0]["text"] == provider_text
    assert report["transformationEngine"] == "provider"


def test_codemix_mode_preserves_english_brand_spelling():
    assert resolve_sarvam_request_options("auto", "original") == {
        "mode": "codemix",
        "language_code": "unknown",
    }
    assert normalize_caption_text("मेरा BrandX phone है.", "auto_mixed_indian") == (
        "मेरा BrandX phone है."
    )


def test_hindi_nasals_are_contextual_not_globally_m_or_n():
    assert "ng" in romanizeHindiText("अंक")
    assert "n" in romanizeHindiText("संदेश")
    assert "m" in romanizeHindiText("संपर्क")


def test_terminal_schwa_is_limited_to_consonant_final_tokens():
    assert not romanizeHindiText("भारत").endswith("a")
    assert romanizeHindiText("माला").endswith("aa")


def test_dictionary_replacement_is_token_aware_and_preserves_brand_case():
    normalized = normalize_caption_text(
        "maim, domainmail BrandX haim!",
        "hinglish",
    )
    assert normalized == "main, domainmail BrandX hain!"


def test_unicode_punctuation_numbers_and_dates_are_preserved():
    decomposed = "Cafe\u0301 — नमस्ते, 23/07/2026!"
    normalized = normalize_caption_text(decomposed, "hindi")
    assert normalized == unicodedata.normalize("NFC", decomposed)
