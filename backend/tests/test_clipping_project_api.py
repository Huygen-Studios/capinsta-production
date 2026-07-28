import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest

from server import main
from server.api import clipping_projects
from server.auth import AuthenticatedUser
from server.pagination import encode_cursor


def _request(method: str, path: str, **kwargs):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://test",
        ) as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(run())


@pytest.fixture
def enabled_api(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("ENABLE_CLIPPING_PROJECT_API", "true")
    monkeypatch.setenv("CLIPPING_PROJECT_PAGE_SIZE_MAX", "100")


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

    async def create_project(self, actor, body, **kwargs):
        self.calls.append(("create", actor, body, kwargs))
        now = datetime.now(timezone.utc).isoformat()
        return {
            "project": {"clipProjectId": "clip_test", "revision": 1},
            "revision": 1,
            "createdAt": now,
            "updatedAt": now,
            "archivedAt": None,
        }

    async def list_recommendations(self, actor, project_id, **kwargs):
        self.calls.append(("recommendations", actor, project_id, kwargs))
        return []


def test_clipping_routes_require_authentication(enabled_api):
    response = _request("GET", "/api/v1/clipping/projects")
    assert response.status_code == 401
    assert response.json()["code"] == "missing_bearer"


def test_api_is_disabled_by_default(monkeypatch, authenticated):
    monkeypatch.delenv("ENABLE_CLIPPING_PROJECT_API", raising=False)
    response = _request(
        "GET", "/api/v1/clipping/projects", headers={"Authorization": "Bearer test"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "clipping_api_disabled"


def test_create_project_uses_verified_actor_and_idempotency(
    monkeypatch, enabled_api, authenticated
):
    repository = FakeRepository()
    monkeypatch.setattr(clipping_projects, "_repository", lambda: repository)
    asset_id = str(uuid4())
    response = _request(
        "POST",
        "/api/v1/clipping/projects",
        headers={"Authorization": "Bearer test", "Idempotency-Key": "create-api-1"},
        json={
            "mediaAssetId": asset_id,
            "transcriptId": "tr_test",
            "name": "Test project",
            "canvas": {"aspectRatio": "9:16", "width": 1080, "height": 1920},
            "metadata": {},
        },
    )
    assert response.status_code == 201
    _, actor, body, options = repository.calls[0]
    assert str(actor.user_id) == authenticated.id
    assert str(body.mediaAssetId) == asset_id
    assert options["idempotency_key"] == "create-api-1"


@pytest.mark.parametrize(
    "payload",
    [
        {
            "mediaAssetId": "not-a-uuid",
            "transcriptId": "tr_test",
            "name": "Test",
            "canvas": {"aspectRatio": "9:16", "width": 1080, "height": 1920},
        },
        {
            "mediaAssetId": "00000000-0000-0000-0000-000000000001",
            "transcriptId": "tr_test",
            "name": "Test",
            "canvas": {"aspectRatio": "9:16", "width": 1, "height": 1920},
        },
        {
            "mediaAssetId": "00000000-0000-0000-0000-000000000001",
            "transcriptId": "tr_test",
            "name": "Test",
            "canvas": {"aspectRatio": "9:16", "width": 1080, "height": 1920},
            "ownerUserId": "00000000-0000-0000-0000-000000000002",
        },
    ],
)
def test_create_request_rejects_invalid_or_owner_controlled_fields(
    payload, enabled_api, authenticated
):
    response = _request(
        "POST",
        "/api/v1/clipping/projects",
        headers={"Authorization": "Bearer test", "Idempotency-Key": "invalid-api-1"},
        json=payload,
    )
    assert response.status_code == 422


def test_recommendation_list_defaults_to_current_proposals(
    monkeypatch, enabled_api, authenticated
):
    repository = FakeRepository()
    monkeypatch.setattr(clipping_projects, "_repository", lambda: repository)
    response = _request(
        "GET",
        "/api/v1/clipping/projects/clip_test/recommendations",
        headers={"Authorization": "Bearer test"},
    )
    assert response.status_code == 200
    assert repository.calls[0][3]["status"] == "proposed"
    assert response.json()["pagination"]["hasMore"] is False


def test_filtered_cursor_cannot_be_reused_with_other_filters(
    enabled_api, authenticated
):
    cursor = encode_cursor(
        created_at=datetime.now(timezone.utc).isoformat(),
        item_id="clip_test",
        context="projects:archived=False:status=draft",
    )
    response = _request(
        "GET",
        f"/api/v1/clipping/projects?status=ready&cursor={cursor}",
        headers={"Authorization": "Bearer test"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_cursor"


def test_routes_are_registered_under_both_api_prefixes():
    paths = set(main.app.openapi()["paths"])
    assert "/api/clipping/projects" in paths
    assert "/api/v1/clipping/projects" in paths
    assert "/api/v1/clipping/projects/{project_id}/recommendations/decisions" in paths
    assert "/api/v1/clipping/projects/{project_id}/drafts/from-accepted-recommendations" in paths
