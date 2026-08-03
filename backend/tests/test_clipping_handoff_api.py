import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest

from server import main
from server.api import clipping_handoffs
from server.auth import AuthenticatedUser
from server.clipping_storage.config import MediaStorageConfig
from server.runtime_policy import _permission_for_path


def _request(method: str, path: str, **kwargs):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://test",
        ) as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(run())


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("ENABLE_CAPINSTA_PROJECT_HANDOFF", "true")
    monkeypatch.setenv("ENABLE_SERVER_BACKED_EDITOR_MEDIA", "true")


@pytest.fixture
def authenticated(monkeypatch):
    user = AuthenticatedUser(id=str(uuid4()), email="safe@example.invalid")
    monkeypatch.setattr(main, "authenticate_request", lambda unused: user)

    async def allow(*unused):
        return None

    monkeypatch.setattr(main, "require_active_account", allow)
    monkeypatch.setattr(main, "require_backend_capability", allow)
    return user


class FakeRepository:
    def __init__(self):
        self.calls = []
        self.handoff_id = uuid4()

    async def prepare(self, actor, project_id, request, **kwargs):
        self.calls.append(("prepare", actor, project_id, request, kwargs))
        return {
            "handoffId": str(self.handoff_id),
            "status": "prepared",
            "targetProjectId": request.targetProjectId,
            "expiresAt": datetime.now(timezone.utc).isoformat(),
            "openPath": f"/editor/handoff/{self.handoff_id}",
            "replayed": False,
        }

    async def claim(self, actor, handoff_id):
        self.calls.append(("claim", actor, handoff_id))
        return {"handoff": {}, "claim": {"status": "claimed"}}


def test_handoff_routes_require_authentication(enabled):
    response = _request(
        "POST",
        f"/api/v1/clipping/handoffs/{uuid4()}/claim",
    )
    assert response.status_code == 401
    assert response.json()["code"] == "missing_bearer"


def test_prepare_uses_verified_actor_and_idempotency(
    monkeypatch, enabled, authenticated
):
    repository = FakeRepository()
    monkeypatch.setattr(
        clipping_handoffs, "_repository", lambda unused_config: repository
    )
    response = _request(
        "POST",
        "/api/v1/clipping/projects/clip_1/handoff",
        headers={
            "Authorization": "Bearer test",
            "Idempotency-Key": "prepare-handoff-1",
        },
        json={
            "expectedRevision": 4,
            "targetProjectId": "capinsta_target",
            "options": {"includeCaptions": True},
        },
    )
    assert response.status_code == 201
    _, actor, project_id, body, options = repository.calls[0]
    assert str(actor.user_id) == authenticated.id
    assert project_id == "clip_1"
    assert body.expectedRevision == 4
    assert options["idempotency_key"] == "prepare-handoff-1"
    assert "token" not in response.json()["openPath"]


def test_server_backed_media_defaults_on_for_manual_clipper(
    monkeypatch, authenticated
):
    monkeypatch.setenv("ENABLE_CAPINSTA_PROJECT_HANDOFF", "true")
    monkeypatch.delenv("ENABLE_SERVER_BACKED_EDITOR_MEDIA", raising=False)
    repository = FakeRepository()
    monkeypatch.setattr(
        clipping_handoffs, "_repository", lambda unused_config: repository
    )

    response = _request(
        "POST",
        "/api/v1/clipping/projects/clip_1/handoff",
        headers={
            "Authorization": "Bearer test",
            "Idempotency-Key": "manual-clipper-handoff-1",
        },
        json={"expectedRevision": 1, "targetProjectId": "clip_1"},
    )

    assert response.status_code == 201

    monkeypatch.setenv("ENABLE_SERVER_BACKED_EDITOR_MEDIA", "false")
    disabled = _request(
        "POST",
        "/api/v1/clipping/projects/clip_1/handoff",
        headers={
            "Authorization": "Bearer test",
            "Idempotency-Key": "manual-clipper-handoff-2",
        },
        json={"expectedRevision": 1, "targetProjectId": "clip_1"},
    )
    assert disabled.status_code == 404


def test_prepare_rejects_missing_or_invalid_idempotency_key(
    monkeypatch, enabled, authenticated
):
    repository = FakeRepository()
    monkeypatch.setattr(
        clipping_handoffs, "_repository", lambda unused_config: repository
    )
    payload = {"expectedRevision": 1, "targetProjectId": "target"}
    missing = _request(
        "POST",
        "/api/v1/clipping/projects/clip_1/handoff",
        headers={"Authorization": "Bearer test"},
        json=payload,
    )
    invalid = _request(
        "POST",
        "/api/v1/clipping/projects/clip_1/handoff",
        headers={
            "Authorization": "Bearer test",
            "Idempotency-Key": "bad key",
        },
        json=payload,
    )
    assert missing.status_code == 422
    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "invalid_idempotency_key"


def test_handoff_routes_are_dual_registered():
    paths = set(main.app.openapi()["paths"])
    assert "/api/clipping/projects/{project_id}/handoff" in paths
    assert "/api/v1/clipping/handoffs/{handoff_id}/claim" in paths
    assert "/api/v1/clipping/handoffs/{handoff_id}/complete" in paths
    assert "/api/v1/capinsta/media/{media_asset_id}/access" in paths


def test_handoff_requires_clipper_entitlement_and_editor_media_stays_editor_scoped():
    assert (
        _permission_for_path("/api/v1/clipping/handoffs/example/claim")
        == "clipper.access"
    )
    assert (
        _permission_for_path("/api/v1/capinsta/media/example/access")
        == "editor.access"
    )


def test_editor_media_access_returns_ready_proxy(
    monkeypatch, enabled, authenticated
):
    media_asset_id = uuid4()

    class Cursor:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *unused):
            return None

        async def execute(self, query, params):
            assert "variant_type='proxy'" in query
            assert params == (media_asset_id, 4)

        async def fetchone(self):
            return {
                "storage_bucket": "media-variants",
                "storage_path": f"{authenticated.id}/{media_asset_id}/proxy.mp4",
                "mime_type": "video/mp4",
                "size_bytes": 123,
                "duration_ms": 60_000,
            }

    class Connection:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *unused):
            return None

        def cursor(self):
            return Cursor()

    class Database:
        def connection(self):
            return Connection()

    class Repository:
        def __init__(self, unused):
            pass

        async def get_asset(self, actor, asset_id, **unused):
            assert str(actor.user_id) == authenticated.id
            assert asset_id == media_asset_id
            return {"revision": 4, "duration_ms": 60_000}

    class Storage:
        def __init__(self, unused):
            pass

        async def create_read_url(self, **kwargs):
            assert kwargs["bucket"] == "media-variants"
            return "https://storage.invalid/proxy?token=ephemeral"

    monkeypatch.setattr(clipping_handoffs, "DurableDatabase", Database)
    monkeypatch.setattr(clipping_handoffs, "MediaStorageRepository", Repository)
    monkeypatch.setattr(
        clipping_handoffs, "media_storage_for_provider", lambda _provider, _config: Storage(_config)
    )
    monkeypatch.setattr(
        clipping_handoffs.MediaStorageConfig,
        "from_env",
        lambda: MediaStorageConfig(
            enabled=True,
            supabase_url="https://example.supabase.co",
            service_role_key="test",
        ),
    )

    response = _request(
        "POST",
        f"/api/v1/capinsta/media/{media_asset_id}/access",
        headers={"Authorization": "Bearer test"},
    )
    assert response.status_code == 200
    assert response.json()["variantType"] == "proxy"
    assert response.json()["sizeBytes"] == 123
