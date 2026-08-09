from fastapi.testclient import TestClient
from starlette.formparsers import MultiPartParser
from starlette.requests import Request

from server.settings import MAX_FORM_BODY_BYTES
from server.main import app
from server.request_limits import evaluate_request_body_limit


def test_backend_errors_use_structured_envelope_and_security_headers():
    client = TestClient(app)

    response = client.get("/api/does-not-exist", headers={"X-Request-ID": "req-test"})

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "not_found",
            "message": "The requested resource was not found.",
            "requestId": "req-test",
        }
    }
    assert response.headers["X-Request-ID"] == "req-test"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "camera=()" in response.headers["Permissions-Policy"]


def test_oversized_json_request_rejected_before_route_parsing():
    client = TestClient(app)

    response = client.post(
        "/api/admin/transcription/test",
        content=b'{"payload":"' + (b"x" * (1024 * 1024 + 1)) + b'"}',
        headers={
            "Content-Type": "application/json",
            "X-Request-ID": "req-large-json",
        },
    )

    assert response.status_code == 413
    assert response.json() == {
        "error": {
            "code": "upload_too_large",
            "message": "The request exceeds the configured upload limit.",
            "requestId": "req-large-json",
            "actualBytes": 1048591,
            "allowedBytes": 1048576,
        }
    }


def test_multipart_uploads_use_upload_body_limit_not_json_limit():
    request = TestClient(app).build_request(
        "POST",
        "/api/media/assets",
        files={"file": ("sample.mp4", b"x" * (2 * 1024 * 1024), "video/mp4")},
    )

    decision = evaluate_request_body_limit(request)

    assert decision.allowed is True
    assert decision.limit and decision.limit > 2 * 1024 * 1024


def test_multipart_text_parts_can_exceed_starlette_default_one_megabyte():
    assert MultiPartParser.__init__.__kwdefaults__["max_part_size"] == MAX_FORM_BODY_BYTES
    assert Request.form.__kwdefaults__["max_part_size"] == MAX_FORM_BODY_BYTES
    assert Request._get_form.__kwdefaults__["max_part_size"] == MAX_FORM_BODY_BYTES


def test_chunked_media_uploads_allow_bounded_binary_parts():
    request = TestClient(app).build_request(
        "PUT",
        "/api/media/assets/chunked/upload-1",
        content=b"x" * (5 * 1024 * 1024),
        headers={"Content-Type": "application/octet-stream"},
    )

    decision = evaluate_request_body_limit(request)

    assert decision.allowed is True
    assert decision.limit == 6 * 1024 * 1024


def test_local_tus_uploads_allow_bounded_binary_parts():
    request = TestClient(app).build_request(
        "PATCH",
        "/api/clipping/media/uploads/00000000-0000-0000-0000-000000000000/tus",
        content=b"x" * 5_000_000,
        headers={"Content-Type": "application/offset+octet-stream"},
    )

    decision = evaluate_request_body_limit(request)

    assert decision.allowed is True
    assert decision.limit == 6 * 1024 * 1024
