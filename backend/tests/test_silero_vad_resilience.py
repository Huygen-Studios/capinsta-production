import pytest

from ai_pipeline.pipeline_config import VadConfig, resolve_pipeline_config
from ai_pipeline.sync.final_quality_gate import TimingQualityError, validate_final_timing_quality
from ai_pipeline.timing import categorize_silero_error, check_silero_readiness
from server.production.doctor import _silero_vad_report


def test_vad_config_defaults():
    config = resolve_pipeline_config({})
    assert config.vad.sileroEnabled is True
    assert config.vad.sileroRequired is False


def test_vad_config_snapshot_override():
    config = resolve_pipeline_config({"vad": {"sileroEnabled": True, "sileroRequired": True}})
    assert config.vad.sileroEnabled is True
    assert config.vad.sileroRequired is True


def test_categorize_silero_error_safe_categories():
    assert categorize_silero_error(ImportError("No module named 'silero_vad'")) == "silero_module_missing"
    assert categorize_silero_error(ImportError("No module named 'torch'")) == "silero_torch_unavailable"
    assert categorize_silero_error(RuntimeError("Model file missing or corrupted")) == "silero_model_missing"
    assert categorize_silero_error(Exception("Failed to load model weights")) == "silero_model_load_failed"
    assert categorize_silero_error(ValueError("Invalid audio sample rate 8000")) == "silero_invalid_audio"
    assert categorize_silero_error(Exception("Some unknown error")) == "silero_unknown_failure"


def test_check_silero_readiness_structure():
    readiness = check_silero_readiness(force_recheck=True)
    assert "sileroEnabled" in readiness
    assert "sileroRequired" in readiness
    assert "sileroImportable" in readiness
    assert "sileroModelLoadable" in readiness
    assert "sileroInferenceReady" in readiness
    assert "fallbackAvailable" in readiness


def test_doctor_silero_vad_report():
    report, ok = _silero_vad_report()
    assert "sileroVad" in report
    status = report["sileroVad"]["status"]
    assert status in {"silero_vad_ready", "silero_optional_degraded", "silero_required_unavailable", "silero_vad_unavailable_no_fallback"}
