import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx

from server import main
from server.api import clipping_media
from server.auth import AuthenticatedUser
from server.clipping_storage.models import UploadInstructions


def _request(method: str, path: str, **kwargs):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://test",
        ) as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(run())


def test_r2_upload_creation_route_returns_201(monkeypatch):
    user = AuthenticatedUser(id=str(uuid4()), email="safe@example.invalid")
    monkeypatch.setattr(main, "authenticate_request", lambda unused: user)

    async def allow(*unused):
        return None

    monkeypatch.setattr(main, "require_active_account", allow)
    monkeypatch.setattr(main, "require_backend_capability", allow)
    monkeypatch.delenv("DISABLE_NEW_UPLOADS", raising=False)

    class Upload:
        calls = 0
        storage = object()

        async def create_upload_session(self, actor, **kwargs):
            self.calls += 1
            return UploadInstructions(
                media_asset_id=uuid4(),
                upload_session_id=uuid4(),
                protocol="s3_multipart",
                upload_url=None,
                required_headers={},
                upload_metadata={},
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
                maximum_size_bytes=2_147_483_648,
                provider="r2",
                part_size_bytes=33_554_432,
                part_count=15,
                upload_concurrency=3,
                signed_url_ttl_seconds=900,
            )

    upload = Upload()
    monkeypatch.setattr(clipping_media, "_services", lambda: (upload, None, None))

    response = _request(
        "POST",
        "/api/clipping/media/uploads",
        headers={"Authorization": "Bearer test", "Idempotency-Key": "upload-test"},
        json={"displayName": "video.mp4", "mimeType": "video/mp4", "sizeBytes": 480_531_086},
    )

    assert response.status_code == 201
    body = response.json()
    assert upload.calls == 1
    assert body["provider"] == "r2"
    assert body["protocol"] == "s3_multipart"
    assert body["partSizeBytes"] == 33_554_432
    assert body["partCount"] == 15
    assert body["uploadConcurrency"] == 3
    assert body["signedUrlTtlSeconds"] == 900
    assert "secret" not in response.text.lower()
    assert "access_key" not in response.text.lower()
