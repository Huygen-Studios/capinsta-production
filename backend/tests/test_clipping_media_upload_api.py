import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx

from server import main
from server.api import clipping_media
from server.auth import AuthenticatedUser
from server.clipping_storage.models import UploadInstructions
from server.clipping_storage.errors import StorageError


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
    assert body["uploadedParts"] == []
    assert "secret" not in response.text.lower()
    assert "access_key" not in response.text.lower()


def test_r2_upload_creation_returns_safe_structured_storage_error(monkeypatch):
    user = AuthenticatedUser(id=str(uuid4()), email="safe@example.invalid")
    monkeypatch.setattr(main, "authenticate_request", lambda unused: user)

    async def allow(*unused):
        return None

    monkeypatch.setattr(main, "require_active_account", allow)
    monkeypatch.setattr(main, "require_backend_capability", allow)
    monkeypatch.delenv("DISABLE_NEW_UPLOADS", raising=False)

    class Upload:
        storage = object()

        async def create_upload_session(self, actor, **kwargs):
            raise StorageError(
                "storage_schema_outdated",
                "The media database migration is incomplete. Apply migration 0028.",
                {"stage": "schema_readiness"},
            )

    monkeypatch.setattr(clipping_media, "_services", lambda: (Upload(), None, None))
    response = _request(
        "POST",
        "/api/clipping/media/uploads",
        headers={
            "Authorization": "Bearer test",
            "Idempotency-Key": "upload-test",
            "X-Request-ID": "safe-request-id",
        },
        json={"displayName": "video.mp4", "mimeType": "video/mp4", "sizeBytes": 100},
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": {
            "code": "storage_schema_outdated",
            "message": "The media database migration is incomplete. Apply migration 0028.",
            "stage": "schema_readiness",
            "requestId": "safe-request-id",
        }
    }


def test_r2_upload_creation_guards_response_serialization(monkeypatch):
    user = AuthenticatedUser(id=str(uuid4()), email="safe@example.invalid")
    monkeypatch.setattr(main, "authenticate_request", lambda unused: user)

    async def allow(*unused):
        return None

    monkeypatch.setattr(main, "require_active_account", allow)
    monkeypatch.setattr(main, "require_backend_capability", allow)
    monkeypatch.delenv("DISABLE_NEW_UPLOADS", raising=False)

    class Instructions:
        upload_session_id = uuid4()

        def as_dict(self):
            raise RuntimeError("secret upload-id object/path")

    class Upload:
        storage = object()

        async def create_upload_session(self, actor, **kwargs):
            return Instructions()

    monkeypatch.setattr(clipping_media, "_services", lambda: (Upload(), None, None))
    response = _request(
        "POST",
        "/api/clipping/media/uploads",
        headers={
            "Authorization": "Bearer test",
            "Idempotency-Key": "upload-test",
            "X-Request-ID": "safe-request-id",
        },
        json={"displayName": "video.mp4", "mimeType": "video/mp4", "sizeBytes": 100},
    )

    assert response.status_code == 500
    assert response.json()["detail"]["stage"] == "response_serialization"
    assert response.json()["detail"]["requestId"] == "safe-request-id"
    assert "object/path" not in response.text
    assert "upload-id" not in response.text
