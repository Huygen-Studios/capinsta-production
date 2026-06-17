from ai_pipeline.language_modes import normalize_language_mode
from ai_pipeline.transcriber import OPENAI_KEY_ERROR, _looks_like_auth_error


def test_telugu_aliases_normalize_to_telgish():
    assert normalize_language_mode("telgish") == "telgish"
    assert normalize_language_mode("teluglish") == "telgish"
    assert normalize_language_mode("telugu") == "telgish"


def test_openai_auth_error_detection_for_raw_provider_message():
    raw = "Error code: 401 - {'error': {'message': 'Invalid API Key', 'code': 'invalid_api_key'}}"
    assert _looks_like_auth_error(RuntimeError(raw))
    assert "OPENAI_API_KEY" in OPENAI_KEY_ERROR
