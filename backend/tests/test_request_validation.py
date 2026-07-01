import pytest
from fastapi.testclient import TestClient

from server.main import app
from server.request_validation import UnsafeJsonPayload, validate_client_json_object


def test_client_json_validation_rejects_nosql_operator_keys():
    with pytest.raises(UnsafeJsonPayload):
        validate_client_json_object({"provider": {"$ne": "sarvam"}})


def test_client_json_validation_rejects_dotted_keys():
    with pytest.raises(UnsafeJsonPayload):
        validate_client_json_object({"provider.mode": "translate"})


def test_client_json_validation_accepts_typed_plain_options():
    assert validate_client_json_object(
        {
            "mode": "transcribe",
            "timestamps": {"enabled": True, "maxAlternatives": 1},
            "hints": ["caption", "telugu"],
        }
    ) == {
        "mode": "transcribe",
        "timestamps": {"enabled": True, "maxAlternatives": 1},
        "hints": ["caption", "telugu"],
    }


def test_admin_transcription_test_rejects_nosql_payload_with_safe_error():
    client = TestClient(app)

    response = client.post(
        "/api/admin/transcription/test",
        json={
            "configurationId": "cfg-test",
            "provider": "sarvam",
            "model": "saaras:v3",
            "version": 1,
            "timestampStrategy": "provider_words",
            "strictProvider": True,
            "providerOptions": {"$where": "sleep(1000)"},
            "pipelineOptions": {},
            "reason": "Testing unsafe option rejection",
        },
        headers={"X-Request-ID": "req-nosql"},
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "validation_failed",
            "message": "The request failed validation.",
            "requestId": "req-nosql",
        }
    }
