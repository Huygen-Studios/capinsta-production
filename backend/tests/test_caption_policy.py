import asyncio
import sqlite3

import pytest
from fastapi import HTTPException

from server import runtime_policy
from server.auth import AuthenticatedUser


def _prepare_jobs_db(path):
    connection = sqlite3.connect(path)
    connection.execute(
        "CREATE TABLE jobs (user_id TEXT NOT NULL, status TEXT NOT NULL)"
    )
    connection.commit()
    connection.close()


def _run_policy(monkeypatch, tmp_path, *, seconds, limits=None, super_admin=False):
    db_path = tmp_path / "caption-policy.sqlite"
    _prepare_jobs_db(db_path)
    monkeypatch.setattr(runtime_policy, "DB_PATH", db_path)
    resolved_limits = limits or runtime_policy.UserLimits()

    async def fake_limits(_user_id):
        return resolved_limits

    async def fake_super_admin(_user_id):
        return super_admin

    async def fake_usage(_user_id, _metric):
        return 0.0

    monkeypatch.setattr(runtime_policy, "user_limits", fake_limits)
    monkeypatch.setattr(runtime_policy, "is_super_admin", fake_super_admin)
    monkeypatch.setattr(runtime_policy, "_daily_usage", fake_usage)
    return asyncio.run(
        runtime_policy.enforce_caption_quota("authenticated-user", seconds)
    )


@pytest.mark.parametrize("seconds", [179.0, 180.0, 180.00001])
def test_regular_user_allows_video_through_three_minutes(
    monkeypatch, tmp_path, seconds
):
    limits = _run_policy(monkeypatch, tmp_path, seconds=seconds)
    assert limits.max_upload_duration_seconds == 180


def test_regular_user_rejects_video_over_three_minutes_with_duration_code(
    monkeypatch, tmp_path
):
    with pytest.raises(HTTPException) as raised:
        _run_policy(monkeypatch, tmp_path, seconds=181.0)

    assert raised.value.status_code == 422
    assert raised.value.detail["code"] == "caption_duration_limit_exceeded"
    assert raised.value.detail["actualDurationSeconds"] == 181.0
    assert raised.value.detail["allowedDurationSeconds"] == 180


def test_super_admin_bypasses_duration_and_caption_quota(monkeypatch, tmp_path):
    limits = runtime_policy.UserLimits(
        daily_caption_minutes=0,
        max_upload_duration_seconds=1,
        max_concurrent_caption_jobs=1,
    )
    resolved = _run_policy(
        monkeypatch,
        tmp_path,
        seconds=3600.0,
        limits=limits,
        super_admin=True,
    )
    assert resolved == limits


def test_ordinary_user_cannot_bypass_quota_with_client_role_data(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("IS_SUPER_ADMIN", "true")
    limits = runtime_policy.UserLimits(
        daily_caption_minutes=0,
        max_upload_duration_seconds=180,
    )
    with pytest.raises(HTTPException) as raised:
        _run_policy(
            monkeypatch,
            tmp_path,
            seconds=60.0,
            limits=limits,
            super_admin=False,
        )

    assert raised.value.detail["code"] == "daily_caption_quota_exceeded"


def test_super_admin_bypasses_caption_plan_capability_checks(monkeypatch):
    async def fake_super_admin(_user_id):
        return True

    async def unexpected_profile_lookup(*_args, **_kwargs):
        raise AssertionError("super-admin plan bypass should return before profile lookup")

    monkeypatch.setattr(runtime_policy, "is_super_admin", fake_super_admin)
    monkeypatch.setattr(runtime_policy, "_rest_profile", unexpected_profile_lookup)

    asyncio.run(
        runtime_policy.require_backend_capability(
            AuthenticatedUser(id="server-authenticated-super-admin"),
            "/api/jobs",
        )
    )
