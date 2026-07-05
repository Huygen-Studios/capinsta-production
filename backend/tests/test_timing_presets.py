from __future__ import annotations

import pytest

from ai_pipeline.pipeline_config import resolve_pipeline_config
from ai_pipeline.timing_presets import (
    CONFIG_FIELD_RANGES,
    TIMING_PRESETS,
    public_preset_registry,
    validate_preset_compatibility,
)
from ai_pipeline.language_modes import normalize_word_token_with_metadata
from ai_pipeline.transcript_normalizer import _normalize_word
from server.transcription_catalog import TRANSCRIPTION_PROVIDER_CATALOG, catalog_entry, public_catalog
from server.transcription_catalog import canonical_catalog_selection, validate_catalog_selection


def test_all_required_timing_presets_are_declared_and_resolve():
    expected = {
        "sarvam_telgish_safe_native",
        "sarvam_telgish_balanced",
        "sarvam_fast_dialogue",
        "sarvam_music_pause_protection",
        "sarvam_noisy_outdoor",
        "sarvam_two_speaker_dialogue",
        "sarvam_code_switch",
        "sarvam_clean_monologue",
        "provider_native_word_timing",
        "strict_timing_qa",
    }

    assert {preset.id for preset in TIMING_PRESETS} == expected
    for preset in TIMING_PRESETS:
        resolved = resolve_pipeline_config(preset.pipeline_options)
        assert resolved.alignment.allowStableTsOrderFallback is False
        assert resolved.quality.maximumEstimatedWordRatio is None
        assert resolved.captionChunking.maxWords <= 4


def test_preset_provider_model_compatibility_targets_real_catalog_entries():
    for preset in TIMING_PRESETS:
        for provider in preset.provider_keys:
            assert provider in {"gemini", "openai", "sarvam"}
        for model in preset.model_keys:
            assert any(entry.model == model for entry in TRANSCRIPTION_PROVIDER_CATALOG)

    sarvam_entry = catalog_entry("sarvam", "saaras:v3")
    assert sarvam_entry is not None
    validate_preset_compatibility(
        "sarvam_telgish_balanced",
        sarvam_entry.provider,
        sarvam_entry.model,
        timestamp_strategy=sarvam_entry.timestamp_strategy,
    )

    with pytest.raises(ValueError):
        validate_preset_compatibility(
            "sarvam_telgish_balanced",
            "openai",
            "whisper-1",
            timestamp_strategy="provider_word",
        )
    with pytest.raises(ValueError, match="unknown_timing_preset"):
        validate_preset_compatibility(
            "Sarvam Telgish Balanced",
            "sarvam",
            "saaras:v3",
            timestamp_strategy="provider_word",
        )


def test_public_preset_registry_exposes_backend_ranges_and_compatibility():
    registry = public_preset_registry(public_catalog())

    assert len(registry["presets"]) == 10
    assert "quality.maximumEstimatedWordRatio" not in registry["fieldRanges"]
    assert "quality.maximumDeterministicFallbackRatio" not in registry["fieldRanges"]
    assert "quality.minimumRealTimedWordCoverage" not in registry["fieldRanges"]
    assert registry["fieldRanges"]["performance.stableTsMaxAudioSeconds"] == CONFIG_FIELD_RANGES["performance.stableTsMaxAudioSeconds"]
    balanced = next(item for item in registry["presets"] if item["id"] == "sarvam_telgish_balanced")
    assert balanced["expectedTimingSourcePolicy"] == "native_then_forced"
    assert any(item["provider"] == "sarvam" and item["model"] == "saaras:v3" for item in balanced["compatibilities"])


def test_provider_display_names_are_not_provider_keys():
    for entry in TRANSCRIPTION_PROVIDER_CATALOG:
        assert catalog_entry(entry.display_name, entry.model) is None
        assert catalog_entry(entry.provider, entry.model) is not None


def test_legacy_display_labels_resolve_only_through_explicit_alias_map():
    provider, model, aliases = canonical_catalog_selection(
        "Sarvam Saaras v3",
        "Sarvam Saaras v3",
    )

    assert (provider, model) == ("sarvam", "saaras:v3")
    assert "provider_display_label" in aliases
    assert "model_display_label" in aliases
    assert validate_catalog_selection(
        "Sarvam Saaras v3",
        "Sarvam Saaras v3",
        "provider_word",
    ).model == "saaras:v3"


def test_telgish_display_normalization_keeps_reviewed_mappings_conservative():
    mappings = {
        "ramdi": "randi",
        "emta": "enta",
        "amdukane": "andukane",
        "kimda": "kinda",
        "umdi": "undi",
        "kottimdaam": "kottindaam",
        "aagamdi": "aagandi",
        "vastumdo": "vastumdo",
    }
    for raw, expected in mappings.items():
        token = normalize_word_token_with_metadata(raw, "telgish")
        assert token["word"] == expected


def test_telgish_script_mismatch_is_diagnostic_not_rewritten():
    token = normalize_word_token_with_metadata("ஆம", "telgish")

    assert token["scriptHint"] == "tamil"
    assert token["suspectedScriptMismatch"] is True
    assert token["scriptMismatchReason"] == "unsupported_script_for_selected_language_mode"
    assert token["word"] == "ஆம"


def test_telgish_unsupported_script_token_is_excluded_from_final_caption():
    word = _normalize_word({"word": "ஆம", "start": 1.0, "end": 1.2}, "telgish")

    assert word is not None
    assert word["suspectedScriptMismatch"] is True
    assert word["excludeFromFinalCaption"] is True
    assert word["excludedFromFinalReason"] == "unsupported_script_for_selected_language_mode"
