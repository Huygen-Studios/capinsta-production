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


def test_options_cors_preflight_clipping_media_uploads_with_idempotency_key():
    headers = {
        "Origin": "https://capinsta.huygenstudios.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
    }
    response = client.options("/api/clipping/media/uploads", headers=headers)
    assert response.status_code in {200, 204}
    assert response.headers.get("access-control-allow-origin") == "https://capinsta.huygenstudios.com"
    allow_headers = response.headers.get("access-control-allow-headers", "").lower()
    assert "idempotency-key" in allow_headers
    assert "authorization" in allow_headers
    assert "content-type" in allow_headers


def test_options_cors_preflight_supports_both_idempotency_headers():
    for req_header in ["idempotency-key", "x-idempotency-key", "authorization,content-type,idempotency-key"]:
        headers = {
            "Origin": "https://capinsta.huygenstudios.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": req_header,
        }
        response = client.options("/api/clipping/media/uploads", headers=headers)
        assert response.status_code in {200, 204}
        assert response.headers.get("access-control-allow-origin") == "https://capinsta.huygenstudios.com"
        allow_headers = response.headers.get("access-control-allow-headers", "").lower()
        assert "idempotency-key" in allow_headers or "x-idempotency-key" in allow_headers


def test_options_does_not_require_auth_header():
    # OPTIONS request with NO Authorization header
    headers = {
        "Origin": "https://capinsta.huygenstudios.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "idempotency-key,content-type",
    }
    response = client.options("/api/clipping/media/uploads", headers=headers)
    assert response.status_code in {200, 204}
    assert response.status_code != 401


def test_disallowed_origin_rejected_by_cors():
    headers = {
        "Origin": "https://malicious-site.attacker.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
    }
    response = client.options("/api/clipping/media/uploads", headers=headers)
    assert response.headers.get("access-control-allow-origin") != "https://malicious-site.attacker.com"


@pytest.mark.parametrize(
    "path",
    [
        "/api/clipping/media/uploads",
        "/api/clipping/projects/proj-123/candidates/cand-456/select",
        "/api/clipping/projects/proj-123/candidates/cand-456/reject",
        "/api/clipping/projects/proj-123/candidates/regenerate",
        "/api/clipping/projects/proj-123/conversion",
        "/api/clipping/projects/proj-123/preview",
        "/api/clipping/projects/proj-123/exports",
        "/api/clipping/projects/proj-123/handoff",
    ],
)
def test_options_cors_preflight_for_all_idempotent_clipper_endpoints(path):
    headers = {
        "Origin": "https://capinsta.huygenstudios.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
    }
    response = client.options(path, headers=headers)
    assert response.status_code in {200, 204}
    assert response.headers.get("access-control-allow-origin") == "https://capinsta.huygenstudios.com"
