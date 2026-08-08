import asyncio
import inspect
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from server.clipping_persistence.models import AuthenticatedActor
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.models import UploadAuthorization
from server.clipping_storage.repository import MediaStorageRepository
from server.clipping_storage.services import MediaUploadService, UploadInstructions


def _actor() -> AuthenticatedActor:
    return AuthenticatedActor.from_verified_user(str(uuid4()))


def test_create_intent_call_site_signature_compliance():
    sig = inspect.signature(MediaStorageRepository.create_intent)
    params = sig.parameters
    assert "storage_bucket" in params
    assert "storage_provider" in params
    assert params["storage_bucket"].default is inspect.Parameter.empty


def test_create_upload_session_r2_passes_correct_fields(monkeypatch):
    async def run():
        config = MediaStorageConfig(
            enabled=True,
            storage_provider="r2",
            r2_source_bucket="custom-r2-source",
            maximum_upload_bytes=100 * 1024 * 1024,
        )
        mock_repository_calls = []

        class MockRepository:
            async def ensure_r2_schema(self):
                pass

            async def bucket_file_size_limit(self, bucket):
                mock_repository_calls.append(("bucket_file_size_limit", bucket))
                return 50 * 1024 * 1024

            async def create_intent(self, actor, **kwargs):
                mock_repository_calls.append(("create_intent", kwargs))
                session_id = uuid4()
                media_asset_id = kwargs["media_asset_id"]
                return (
                    {
                        "id": session_id,
                        "media_asset_id": media_asset_id,
                        "status": "pending",
                        "mime_type": kwargs["mime_type"],
                        "storage_path": kwargs["storage_path"],
                        "upload_protocol": kwargs["upload_protocol"],
                        "expires_at": kwargs["expires_at"],
                        "expected_size_bytes": kwargs["expected_size_bytes"],
                        "storage_provider": kwargs["storage_provider"],
                        "storage_bucket": kwargs["storage_bucket"],
                    },
                    None,
                    False,
                )

            @asynccontextmanager
            async def multipart_authorization_lock(self, actor, session_id):
                yield

            async def mark_authorized(self, actor, session_id, **kwargs):
                return {
                    "id": session_id,
                    "status": "authorized",
                    "multipart_upload_id": "test-upload-id",
                    "multipart_part_size_bytes": 32 * 1024 * 1024,
                    "multipart_part_count": 1,
                    "media_asset_id": uuid4(),
                    "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
                }

            async def get_session(self, actor, session_id):
                return {
                    "id": session_id,
                    "status": "authorized",
                    "multipart_upload_id": "test-upload-id",
                    "multipart_part_size_bytes": 32 * 1024 * 1024,
                    "multipart_part_count": 1,
                    "media_asset_id": uuid4(),
                    "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
                    "storage_bucket": "source-media",
                    "storage_path": "path/video.mp4",
                }

        class MockStorage:
            async def create_upload_session(self, **kwargs):
                return UploadAuthorization(
                    protocol="s3_multipart",
                    upload_url=None,
                    required_headers={},
                    upload_metadata={"upload_id": "test-upload-id"},
                    provider_upload_id="test-upload-id",
                    part_size_bytes=32 * 1024 * 1024,
                    part_count=1,
                )

            async def list_multipart_parts(self, **kwargs):
                return []

        service = MediaUploadService(
            config=config,
            storage=MockStorage(),
            repository=MockRepository(),
        )

        actor = _actor()
        instructions = await service.create_upload_session(
            actor,
            display_name="test.mp4",
            mime_type="video/mp4",
            size_bytes=10 * 1024 * 1024,
            idempotency_key="key-r2-1",
        )

        assert instructions.protocol == "s3_multipart"
        assert not any(c[0] == "bucket_file_size_limit" for c in mock_repository_calls)

        intent_calls = [c[1] for c in mock_repository_calls if c[0] == "create_intent"]
        assert len(intent_calls) == 1
        call_kwargs = intent_calls[0]
        assert call_kwargs["storage_provider"] == "r2"
        assert call_kwargs["storage_bucket"] == "source-media"
        assert call_kwargs["upload_protocol"] == "s3_multipart"

    asyncio.run(run())


def test_create_upload_session_supabase_queries_bucket_limit(monkeypatch):
    async def run():
        config = MediaStorageConfig(
            enabled=True,
            storage_provider="supabase",
            source_bucket="supabase-source-bucket",
            maximum_upload_bytes=100 * 1024 * 1024,
        )
        mock_repository_calls = []

        class MockRepository:
            async def bucket_file_size_limit(self, bucket):
                mock_repository_calls.append(("bucket_file_size_limit", bucket))
                return 50 * 1024 * 1024

            async def create_intent(self, actor, **kwargs):
                mock_repository_calls.append(("create_intent", kwargs))
                session_id = uuid4()
                media_asset_id = kwargs["media_asset_id"]
                return (
                    {
                        "id": session_id,
                        "media_asset_id": media_asset_id,
                        "status": "pending",
                        "mime_type": kwargs["mime_type"],
                        "storage_path": kwargs["storage_path"],
                        "upload_protocol": kwargs["upload_protocol"],
                        "expires_at": kwargs["expires_at"],
                        "expected_size_bytes": kwargs["expected_size_bytes"],
                        "storage_provider": kwargs["storage_provider"],
                        "storage_bucket": kwargs["storage_bucket"],
                    },
                    None,
                    False,
                )

            async def mark_authorized(self, actor, session_id, **kwargs):
                return {
                    "id": session_id,
                    "status": "authorized",
                    "media_asset_id": uuid4(),
                    "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
                }

        class MockStorage:
            async def create_upload_session(self, **kwargs):
                return UploadAuthorization(
                    protocol="tus",
                    upload_url="https://example.invalid/tus/123",
                    required_headers={},
                    upload_metadata={},
                )

        service = MediaUploadService(
            config=config,
            storage=MockStorage(),
            repository=MockRepository(),
        )

        actor = _actor()
        instructions = await service.create_upload_session(
            actor,
            display_name="test.mp4",
            mime_type="video/mp4",
            size_bytes=10 * 1024 * 1024,
            idempotency_key="key-sb-1",
        )

        assert instructions.protocol == "tus"
        assert any(
            c == ("bucket_file_size_limit", "supabase-source-bucket")
            for c in mock_repository_calls
        )
        intent_calls = [c[1] for c in mock_repository_calls if c[0] == "create_intent"]
        assert len(intent_calls) == 1
        call_kwargs = intent_calls[0]
        assert call_kwargs["storage_provider"] == "supabase"
        assert call_kwargs["storage_bucket"] == "supabase-source-bucket"

    asyncio.run(run())


def test_upload_limits_returns_none_bucket_limit_for_r2():
    async def run():
        config = MediaStorageConfig(
            enabled=True,
            storage_provider="r2",
            maximum_upload_bytes=2 * 1024 * 1024 * 1024,
        )

        class MockRepository:
            async def bucket_file_size_limit(self, bucket):
                raise RuntimeError("Should not be called for R2")

        service = MediaUploadService(
            config=config,
            storage=object(),
            repository=MockRepository(),
        )

        limits = await service.upload_limits()
        assert limits["sourceBucketMaximumUploadBytes"] is None
        assert limits["effectiveKnownMaximumUploadBytes"] == 2 * 1024 * 1024 * 1024
        assert limits["limitSource"] == "application"

    asyncio.run(run())
