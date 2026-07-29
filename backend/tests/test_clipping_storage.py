import asyncio
import hashlib
from datetime import datetime, timezone
from uuid import uuid4

import pytest
import requests

from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.errors import StorageError
from server.clipping_storage.paths import (
    extension_for_mime,
    source_object_path,
    validate_display_filename,
    validate_object_path,
)
from server.media_variants.paths import variant_object_path
from server.media_variants.presets import PROXY_SPEC, generation_spec_hash
from server.clipping_storage.r2_storage import R2MediaStorage
from server.clipping_storage.supabase_storage import SupabaseMediaStorage


def _run(coro):
    return asyncio.run(coro)


def _config(**overrides):
    values = {
        "enabled": True,
        "supabase_url": "https://project-ref.supabase.co",
        "service_role_key": "test-service-role",
    }
    values.update(overrides)
    return MediaStorageConfig(**values)


class _Response:
    def __init__(self, status=200, *, payload=None, headers=None):
        self.status_code = status
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload or {}


class _Session:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class _S3Client:
    def __init__(self):
        self.calls = []

    def create_multipart_upload(self, **kwargs):
        self.calls.append(("create_multipart_upload", kwargs))
        return {"UploadId": "upload-1"}

    def generate_presigned_url(self, operation, **kwargs):
        self.calls.append((operation, kwargs))
        return f"https://r2.invalid/{operation}/{kwargs['Params'].get('PartNumber', 'object')}"

    def list_parts(self, **kwargs):
        self.calls.append(("list_parts", kwargs))
        return {
            "Parts": [
                {"PartNumber": 2, "ETag": '"etag-2"', "Size": 5},
                {"PartNumber": 1, "ETag": '"etag-1"', "Size": 5},
            ]
        }

    def complete_multipart_upload(self, **kwargs):
        self.calls.append(("complete_multipart_upload", kwargs))
        return {}

    def head_object(self, **kwargs):
        self.calls.append(("head_object", kwargs))
        return {
            "ContentLength": 10,
            "ContentType": "video/mp4",
            "ETag": '"final-etag"',
            "LastModified": datetime.now(timezone.utc),
        }


def test_safe_stable_versioned_paths_and_mime_extensions():
    owner, asset = uuid4(), uuid4()
    first = source_object_path(
        owner_user_id=owner,
        media_asset_id=asset,
        mime_type="video/mp4",
    )
    assert first == f"{owner}/{asset}/source/v1.mp4"
    assert source_object_path(
        owner_user_id=owner,
        media_asset_id=asset,
        mime_type="video/mp4; charset=binary",
    ) == first
    assert source_object_path(
        owner_user_id=owner,
        media_asset_id=asset,
        mime_type="audio/x-wav",
        version=2,
    ) == f"{owner}/{asset}/source/v2.wav"
    assert source_object_path(
        owner_user_id=uuid4(),
        media_asset_id=asset,
        mime_type="video/mp4",
    ) != first
    assert extension_for_mime("audio/mpeg") == ".mp3"


@pytest.mark.parametrize(
    "path",
    [
        "",
        "/owner/asset/source/v1.mp4",
        "../owner/asset/source/v1.mp4",
        "owner/../asset/source/v1.mp4",
        "owner\\asset\\source\\v1.mp4",
        "owner/asset/source/v1.mp4\x00",
        "not-a-uuid/not-a-uuid/source/v1.mp4",
    ],
)
def test_unsafe_paths_are_rejected(path):
    with pytest.raises(StorageError) as error:
        validate_object_path(path)
    assert error.value.category == "object_path_invalid"


@pytest.mark.parametrize("name", ["", ".", "..", "../video.mp4", "a/b.mp4"])
def test_unsafe_display_filenames_are_rejected(name):
    with pytest.raises(StorageError):
        validate_display_filename(name)


def test_config_is_feature_flagged_and_validates_secrets(monkeypatch):
    monkeypatch.delenv("ENABLE_SUPABASE_MEDIA_STORAGE", raising=False)
    assert MediaStorageConfig.from_env().enabled is False
    monkeypatch.setenv("ENABLE_SUPABASE_MEDIA_STORAGE", "true")
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(StorageError) as error:
        MediaStorageConfig.from_env()
    assert error.value.category == "storage_not_configured"
    assert _config().tus_upload_url == (
        "https://project-ref.storage.supabase.co/storage/v1/upload/resumable"
    )


def test_r2_adapter_creates_signs_and_completes_multipart():
    owner, asset = uuid4(), uuid4()
    path = f"{owner}/{asset}/source/v1.mp4"
    client = _S3Client()
    storage = R2MediaStorage(
        _config(
            storage_provider="r2",
            r2_endpoint_url="https://account.r2.cloudflarestorage.com",
            r2_access_key_id="key",
            r2_secret_access_key="secret",
        ),
        client=client,
    )

    authorization = _run(
        storage.create_upload_session(
            bucket="source-media", path=path, mime_type="video/mp4"
        )
    )
    signed = _run(
        storage.create_upload_part_url(
            bucket="source-media",
            path=path,
            upload_id=authorization.provider_upload_id,
            part_number=2,
            expires_in=900,
        )
    )
    parts = _run(
        storage.list_multipart_parts(
            bucket="source-media",
            path=path,
            upload_id=authorization.provider_upload_id,
        )
    )
    metadata = _run(
        storage.complete_multipart_upload(
            bucket="source-media",
            path=path,
            upload_id=authorization.provider_upload_id,
            parts=parts,
        )
    )

    assert authorization.protocol == "s3_multipart"
    assert signed.endswith("/2")
    assert parts == [
        {"partNumber": 2, "etag": "etag-2", "size": 5},
        {"partNumber": 1, "etag": "etag-1", "size": 5},
    ]
    assert metadata.size_bytes == 10
    complete_call = [
        call for call in client.calls if call[0] == "complete_multipart_upload"
    ][0][1]
    assert complete_call["Bucket"] == "capinsta-source-media"
    assert complete_call["MultipartUpload"] == {
        "Parts": [
            {"PartNumber": 1, "ETag": "etag-1"},
            {"PartNumber": 2, "ETag": "etag-2"},
        ]
    }


def test_production_rejects_local_storage_and_uses_long_media_defaults(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("ENABLE_LOCAL_MEDIA_STORAGE", "true")
    monkeypatch.setenv("CLIPPING_LOCAL_STORAGE_ROOT", str(tmp_path))
    with pytest.raises(StorageError):
        MediaStorageConfig.from_env()

    monkeypatch.setenv("ENABLE_LOCAL_MEDIA_STORAGE", "false")
    monkeypatch.delenv("CLIPPING_LOCAL_STORAGE_ROOT")
    monkeypatch.delenv("MEDIA_UPLOAD_MAX_BYTES", raising=False)
    monkeypatch.delenv("MAX_SOURCE_FILE_BYTES", raising=False)
    config = MediaStorageConfig.from_env()
    assert config.maximum_upload_bytes == 2 * 1024 * 1024 * 1024
    assert config.maximum_active_uploads_per_user == 2


def test_r2_config_accepts_documented_environment_aliases(monkeypatch):
    monkeypatch.setenv("CLIPPING_STORAGE_PROVIDER", "r2")
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-id")
    monkeypatch.setenv("R2_ENDPOINT", "https://account-id.r2.cloudflarestorage.com")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("R2_MULTIPART_CONCURRENCY", "4")
    monkeypatch.setenv("R2_PRESIGNED_UPLOAD_TTL_SECONDS", "600")

    config = MediaStorageConfig.from_env()

    assert config.enabled is True
    assert config.storage_provider == "r2"
    assert config.r2_account_id == "account-id"
    assert config.r2_endpoint_url == "https://account-id.r2.cloudflarestorage.com"
    assert config.r2_upload_concurrency == 4
    assert config.r2_signed_url_ttl_seconds == 600


def test_r2_config_rejects_endpoint_for_wrong_account(monkeypatch):
    monkeypatch.setenv("CLIPPING_STORAGE_PROVIDER", "r2")
    monkeypatch.setenv("R2_ACCOUNT_ID", "expected-account")
    monkeypatch.setenv("R2_ENDPOINT", "https://other-account.r2.cloudflarestorage.com")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")

    with pytest.raises(StorageError) as error:
        MediaStorageConfig.from_env()

    assert error.value.category == "r2_not_configured"


def test_supabase_adapter_upload_inspection_signed_urls_and_delete():
    owner, asset = uuid4(), uuid4()
    path = f"{owner}/{asset}/source/v1.mp4"
    session = _Session(
        [
            _Response(200, payload={"token": "narrow-token"}),
            _Response(
                200,
                headers={
                    "content-length": "123",
                    "content-type": "video/mp4",
                    "etag": '"etag-value"',
                    "last-modified": "Fri, 24 Jul 2026 12:00:00 GMT",
                },
            ),
            _Response(200, payload={"signedURL": "/object/sign/source-media/x?t=p"}),
            _Response(200, payload={"signedURL": "/object/sign/source-media/x?t=d"}),
            _Response(204),
        ]
    )
    storage = SupabaseMediaStorage(_config(), session=session)

    authorization = _run(
        storage.create_upload_session(
            bucket="source-media", path=path, mime_type="video/mp4"
        )
    )
    assert authorization.protocol == "tus"
    assert authorization.required_headers == {
        "x-signature": "narrow-token",
        "x-upsert": "false",
    }
    assert "test-service-role" not in repr(authorization)
    metadata = _run(storage.inspect_object(bucket="source-media", path=path))
    assert metadata.size_bytes == 123
    assert metadata.mime_type == "video/mp4"
    assert metadata.etag == "etag-value"
    assert metadata.updated_at == datetime(2026, 7, 24, 12, tzinfo=timezone.utc)
    preview = _run(
        storage.create_read_url(
            bucket="source-media", path=path, expires_in=900
        )
    )
    download = _run(
        storage.create_download_url(
            bucket="source-media",
            path=path,
            expires_in=300,
            filename="Synthetic video.mp4",
        )
    )
    assert "download" not in preview
    assert "download=Synthetic+video.mp4" in download
    _run(storage.delete_object(bucket="source-media", path=path))
    assert [call[0] for call in session.calls] == [
        "POST",
        "HEAD",
        "POST",
        "POST",
        "DELETE",
    ]


def test_supabase_trusted_variant_upload_is_bounded_and_verified(tmp_path):
    owner, asset = uuid4(), uuid4()
    path = variant_object_path(
        owner_user_id=owner,
        media_asset_id=asset,
        variant_type="proxy",
        source_revision=2,
        spec_hash=generation_spec_hash(PROXY_SPEC),
    )
    source = tmp_path / "proxy.mp4"
    source.write_bytes(b"verified-proxy")
    checksum = hashlib.sha256(source.read_bytes()).hexdigest()
    session = _Session(
        [
            _Response(404),
            _Response(201),
            _Response(
                200,
                headers={
                    "content-length": str(source.stat().st_size),
                    "content-type": "video/mp4",
                    "x-supabase-checksum": checksum,
                },
            ),
        ]
    )
    storage = SupabaseMediaStorage(_config(), session=session)
    result = _run(
        storage.upload_file(
            bucket="media-variants",
            path=path,
            local_path=source,
            content_type="video/mp4",
            maximum_bytes=1024,
            checksum=checksum,
        )
    )
    assert result.checksum == checksum
    assert result.size_bytes == source.stat().st_size
    upload = session.calls[1]
    assert upload[0] == "POST"
    assert upload[2]["headers"]["x-upsert"] == "false"
    assert "test-service-role" not in repr(result)
    with pytest.raises(StorageError) as error:
        _run(
            storage.upload_file(
                bucket="media-exports",
                path=path,
                local_path=source,
                content_type="video/mp4",
                maximum_bytes=1024,
                checksum=checksum,
            )
        )
    assert error.value.category == "bucket_not_allowed"


def test_supabase_variant_upload_deletes_failed_verification(tmp_path):
    owner, asset = uuid4(), uuid4()
    path = variant_object_path(
        owner_user_id=owner,
        media_asset_id=asset,
        variant_type="proxy",
        source_revision=1,
        spec_hash=generation_spec_hash(PROXY_SPEC),
    )
    source = tmp_path / "proxy.mp4"
    source.write_bytes(b"proxy")
    checksum = hashlib.sha256(source.read_bytes()).hexdigest()
    session = _Session(
        [
            _Response(404),
            _Response(201),
            _Response(
                200,
                headers={
                    "content-length": str(source.stat().st_size),
                    "x-supabase-checksum": "different",
                },
            ),
            _Response(204),
        ]
    )
    storage = SupabaseMediaStorage(_config(), session=session)
    with pytest.raises(StorageError) as error:
        _run(
            storage.upload_file(
                bucket="media-variants",
                path=path,
                local_path=source,
                content_type="video/mp4",
                maximum_bytes=1024,
                checksum=checksum,
            )
        )
    assert error.value.category == "storage_metadata_invalid"
    assert [call[0] for call in session.calls] == [
        "HEAD",
        "POST",
        "HEAD",
        "DELETE",
    ]


@pytest.mark.parametrize(
    ("response", "category"),
    [
        (_Response(404), "object_not_found"),
        (_Response(403), "storage_permission_denied"),
        (_Response(500), "storage_provider_unavailable"),
        (requests.ConnectionError("offline"), "storage_provider_unavailable"),
    ],
)
def test_supabase_adapter_normalizes_provider_errors(response, category):
    owner, asset = uuid4(), uuid4()
    storage = SupabaseMediaStorage(_config(), session=_Session([response]))
    with pytest.raises(StorageError) as error:
        _run(
            storage.inspect_object(
                bucket="source-media",
                path=f"{owner}/{asset}/source/v1.mp4",
            )
        )
    assert error.value.category == category


def test_object_exists_maps_only_not_found():
    owner, asset = uuid4(), uuid4()
    path = f"{owner}/{asset}/source/v1.mp4"
    missing = SupabaseMediaStorage(
        _config(), session=_Session([_Response(404)])
    )
    assert _run(missing.object_exists(bucket="source-media", path=path)) is False
    denied = SupabaseMediaStorage(
        _config(), session=_Session([_Response(403)])
    )
    with pytest.raises(StorageError) as error:
        _run(denied.object_exists(bucket="source-media", path=path))
    assert error.value.category == "storage_permission_denied"
