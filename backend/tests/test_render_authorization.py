import base64
import json
import os
import sys
from urllib.parse import parse_qs, urlsplit

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from server.headless_export import (
    ExportStageError,
    _looks_like_sign_in_page,
    authorize_render_url,
    create_render_token,
    redact_render_url,
)


SECRET = "render-secret-with-at-least-32-bytes"


def _decode_payload(token: str) -> dict[str, object]:
    encoded_payload = token.split(".", 1)[0]
    padded = encoded_payload + ("=" * (-len(encoded_payload) % 4))
    return json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))


def test_render_token_binds_export_job_expiration_and_audience():
    token = create_render_token("export-1", secret=SECRET, now=100, ttl_seconds=60)

    payload = _decode_payload(token)

    assert payload == {
        "aud": "capinsta.render",
        "export_job_id": "export-1",
        "exp": 160,
    }


def test_authorize_render_url_appends_job_token_and_preserves_route(monkeypatch):
    monkeypatch.setenv("CAPINSTA_RENDER_TOKEN_SECRET", SECRET)

    authorized = authorize_render_url(
        "https://capinsta.example.com/render?quality=high",
        "export-1",
    )

    parts = urlsplit(authorized)
    query = parse_qs(parts.query)
    assert parts.path == "/render"
    assert query["quality"] == ["high"]
    assert query["export_job_id"] == ["export-1"]
    assert _decode_payload(query["render_token"][0])["export_job_id"] == "export-1"


def test_bundled_render_html_does_not_require_token(monkeypatch):
    monkeypatch.delenv("CAPINSTA_RENDER_TOKEN_SECRET", raising=False)

    assert (
        authorize_render_url("http://127.0.0.1:8000/render.html", "export-1")
        == "http://127.0.0.1:8000/render.html"
    )


def test_missing_render_secret_fails_closed(monkeypatch):
    monkeypatch.delenv("CAPINSTA_RENDER_TOKEN_SECRET", raising=False)

    with pytest.raises(ExportStageError) as exc_info:
        authorize_render_url("https://capinsta.example.com/render", "export-1")

    assert exc_info.value.stage == "composition_load"
    assert "CAPINSTA_RENDER_TOKEN_SECRET" in str(exc_info.value)


def test_render_token_is_redacted_from_urls_and_logs():
    redacted = redact_render_url(
        "requestfailed: https://capinsta.example.com/render?export_job_id=job-1&render_token=super-secret-token net::ERR_ABORTED"
    )

    assert "super-secret-token" not in redacted
    assert "render_token=" in redacted
    assert "export_job_id=job-1" in redacted


def test_sign_in_redirection_is_detected_from_url_or_title():
    assert _looks_like_sign_in_page(
        "https://capinsta.example.com/sign-in?redirect=%2Frender",
        "Sign in — Capinsta",
    )
    assert not _looks_like_sign_in_page(
        "https://capinsta.example.com/render?export_job_id=job-1",
        "Capinsta Renderer",
    )
