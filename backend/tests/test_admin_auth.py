import base64
import hashlib
import hmac
import json
import time
import uuid

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import server.admin_auth as admin_auth


def _request(assertion: str, method: str = "GET", path: str = "/api/admin/jobs") -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "headers": [
                (b"x-capinsta-admin-assertion", assertion.encode()),
                (b"x-correlation-id", b"corr-1"),
            ],
        }
    )


def _assertion(secret: str, permission: str, method: str = "GET", path: str = "/api/admin/jobs", **overrides) -> str:
    now = int(time.time())
    payload = {
        "iss": "capinsta-web",
        "aud": "capinsta-fastapi-admin",
        "sub": "00000000-0000-0000-0000-000000000001",
        "permission": permission,
        "aal": "aal2",
        "jti": str(uuid.uuid4()),
        "iat": now,
        "nbf": now - 1,
        "method": method,
        "path": path,
        "correlation_id": "corr-1",
        "exp": now + 45,
        **overrides,
    }
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    return f"{encoded}.{signature}"


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setenv("INTERNAL_ADMIN_API_SECRET", "x" * 32)
    monkeypatch.setenv("ADMIN_ASSERTION_ISSUER", "capinsta-web")
    monkeypatch.setattr(admin_auth, "_admin_is_currently_authorized", lambda *_: True)
    monkeypatch.setattr(admin_auth, "_consume_assertion_once", lambda *_: True)


def test_backend_admin_assertion_requires_matching_permission():
    assertion = _assertion("x" * 32, "caption_jobs.read")
    admin = admin_auth.require_backend_admin_permission(_request(assertion), "caption_jobs.read")
    assert admin.user_id.endswith("1")
    with pytest.raises(HTTPException) as error:
        admin_auth.require_backend_admin_permission(_request(assertion), "caption_jobs.cancel")
    assert error.value.status_code == 403


@pytest.mark.parametrize(
    "overrides",
    [
        {"aal": "aal1"},
        {"exp": int(time.time()) - 1},
        {"aud": "wrong"},
        {"iss": "wrong"},
        {"nbf": int(time.time()) + 30},
    ],
)
def test_backend_admin_assertion_rejects_invalid_claims(overrides):
    assertion = _assertion("x" * 32, "caption_jobs.read", **overrides)
    with pytest.raises(HTTPException) as error:
        admin_auth.require_backend_admin_permission(_request(assertion), "caption_jobs.read")
    assert error.value.status_code == 403


def test_backend_admin_assertion_rejects_tampering():
    assertion = _assertion("x" * 32, "caption_jobs.read")
    payload, signature = assertion.split(".")
    with pytest.raises(HTTPException) as error:
        admin_auth.require_backend_admin_permission(_request(f"{payload}x.{signature}"), "caption_jobs.read")
    assert error.value.status_code == 401


def test_backend_admin_assertion_is_bound_to_method_and_path():
    assertion = _assertion("x" * 32, "caption_jobs.cancel", method="POST", path="/api/admin/jobs/job-1/cancel")
    with pytest.raises(HTTPException):
        admin_auth.require_backend_admin_permission(
            _request(assertion, method="POST", path="/api/admin/jobs/job-2/cancel"),
            "caption_jobs.cancel",
        )


def test_mutation_assertion_replay_is_rejected(monkeypatch):
    consumed = iter([True, False])
    monkeypatch.setattr(admin_auth, "_consume_assertion_once", lambda *_: next(consumed))
    assertion = _assertion("x" * 32, "caption_jobs.cancel", method="POST", path="/api/admin/jobs/job-1/cancel")
    request = _request(assertion, method="POST", path="/api/admin/jobs/job-1/cancel")
    admin_auth.require_backend_admin_permission(request, "caption_jobs.cancel")
    with pytest.raises(HTTPException) as error:
        admin_auth.require_backend_admin_permission(request, "caption_jobs.cancel")
    assert error.value.status_code == 409


def test_permission_revoked_after_assertion_issuance(monkeypatch):
    monkeypatch.setattr(admin_auth, "_admin_is_currently_authorized", lambda *_: False)
    assertion = _assertion("x" * 32, "caption_jobs.read")
    with pytest.raises(HTTPException) as error:
        admin_auth.require_backend_admin_permission(_request(assertion), "caption_jobs.read")
    assert error.value.status_code == 403
