import os
import pytest
from fastapi.testclient import TestClient

# Ensure CORS_ORIGINS environment variable includes test origin
os.environ["CORS_ORIGINS"] = "https://capinsta.huygenstudios.com"
os.environ["FRONTEND_URL"] = "https://capinsta.huygenstudios.com"

from server.main import app

client = TestClient(app)


def test_health_live_endpoint():
    response = client.get("/api/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["live"] is True
    assert "timestamp" in data


def test_health_ready_endpoint():
    response = client.get("/api/health/ready")
    assert response.status_code in {200, 503}
    data = response.json()
    assert "ready" in data
    assert "dependencies" in data


def test_options_cors_preflight_chunked_upload_start():
    headers = {
        "Origin": "https://capinsta.huygenstudios.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type, x-request-id",
    }
    response = client.options("/api/media/assets/chunked", headers=headers)
    assert response.status_code in {200, 204}
    assert response.headers.get("access-control-allow-origin") == "https://capinsta.huygenstudios.com"
    allow_methods = response.headers.get("access-control-allow-methods", "")
    assert "POST" in allow_methods or "*" in allow_methods
    allow_headers = response.headers.get("access-control-allow-headers", "").lower()
    assert "authorization" in allow_headers or "*" in allow_headers
    assert "content-type" in allow_headers or "*" in allow_headers


def test_options_cors_preflight_chunked_upload_append():
    headers = {
        "Origin": "https://capinsta.huygenstudios.com",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization, content-type, x-upload-offset",
    }
    response = client.options("/api/media/assets/chunked/test-upload-123", headers=headers)
    assert response.status_code in {200, 204}
    assert response.headers.get("access-control-allow-origin") == "https://capinsta.huygenstudios.com"
    allow_headers = response.headers.get("access-control-allow-headers", "").lower()
    assert "x-upload-offset" in allow_headers or "*" in allow_headers


def test_options_cors_preflight_chunked_upload_complete():
    headers = {
        "Origin": "https://capinsta.huygenstudios.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
    }
    response = client.options("/api/media/assets/chunked/test-upload-123/complete", headers=headers)
    assert response.status_code in {200, 204}
    assert response.headers.get("access-control-allow-origin") == "https://capinsta.huygenstudios.com"


def test_options_cors_preflight_export_jobs():
    headers = {
        "Origin": "https://capinsta.huygenstudios.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type, x-idempotency-key",
    }
    response = client.options("/api/export/jobs", headers=headers)
    assert response.status_code in {200, 204}
    assert response.headers.get("access-control-allow-origin") == "https://capinsta.huygenstudios.com"


def test_options_does_not_require_auth_header():
    # OPTIONS request with NO Authorization header
    headers = {
        "Origin": "https://capinsta.huygenstudios.com",
        "Access-Control-Request-Method": "POST",
    }
    response = client.options("/api/media/assets/chunked", headers=headers)
    assert response.status_code in {200, 204}
    # It must NOT return 401 Unauthorized
    assert response.status_code != 401


def test_disallowed_origin_rejected_by_cors():
    headers = {
        "Origin": "https://malicious-site.attacker.com",
        "Access-Control-Request-Method": "POST",
    }
    response = client.options("/api/media/assets/chunked", headers=headers)
    assert response.headers.get("access-control-allow-origin") != "https://malicious-site.attacker.com"
