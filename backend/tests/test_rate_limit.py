import asyncio
import uuid

import pytest
from fastapi import HTTPException, Request

from server.auth import AuthenticatedUser
import server.rate_limit as rate_limit
import server.runtime_policy as runtime_policy


def _request(path: str = "/api/export/jobs", method: str = "POST") -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "headers": [(b"x-forwarded-for", b"203.0.113.10")],
        }
    )


def test_active_admin_bypasses_export_rate_limit_and_redis(monkeypatch):
    user = AuthenticatedUser(id=str(uuid.uuid4()))
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.delenv("UPSTASH_REDIS_REST_URL", raising=False)
    monkeypatch.delenv("UPSTASH_REDIS_REST_TOKEN", raising=False)

    async def active_admin(user_id: str) -> bool:
        assert user_id == user.id
        return True

    monkeypatch.setattr(rate_limit, "is_admin", active_admin)
    monkeypatch.setattr(
        rate_limit,
        "_consume",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("Redis must not be called for an administrator")
        ),
    )

    asyncio.run(rate_limit.enforce_api_rate_limit(_request(), user))


def test_ordinary_user_remains_rate_limited(monkeypatch):
    user = AuthenticatedUser(id=str(uuid.uuid4()))
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://redis.example")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "test-token")

    async def ordinary_user(_user_id: str) -> bool:
        return False

    monkeypatch.setattr(rate_limit, "is_admin", ordinary_user)
    monkeypatch.setattr(rate_limit, "_consume", lambda *_args: (False, 123))

    with pytest.raises(HTTPException) as error:
        asyncio.run(rate_limit.enforce_api_rate_limit(_request(), user))

    assert error.value.status_code == 429
    assert error.value.headers == {"Retry-After": "123"}
    assert error.value.detail["code"] == "rate_limited"


def test_is_admin_requires_active_membership_and_active_profile(monkeypatch):
    user_id = str(uuid.uuid4())
    captured: dict[str, object] = {}
    monkeypatch.setattr(runtime_policy, "_rest_control_plane_enabled", lambda: False)

    async def admin_membership(query: str, params: tuple = ()):
        captured["query"] = query
        captured["params"] = params
        return (1,)

    monkeypatch.setattr(runtime_policy, "_query_one", admin_membership)

    assert asyncio.run(runtime_policy.is_admin(user_id)) is True
    assert "m.active = true" in str(captured["query"])
    assert "p.account_status = 'active'" in str(captured["query"])
    assert captured["params"] == (user_id,)


def test_is_admin_rejects_user_without_admin_membership(monkeypatch):
    monkeypatch.setattr(runtime_policy, "_rest_control_plane_enabled", lambda: False)

    async def no_admin_membership(_query: str, _params: tuple = ()):
        return None

    monkeypatch.setattr(runtime_policy, "_query_one", no_admin_membership)

    assert asyncio.run(runtime_policy.is_admin(str(uuid.uuid4()))) is False
