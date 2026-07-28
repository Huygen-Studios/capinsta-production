from __future__ import annotations

import json
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import pytest
from pydantic import ValidationError

from server.clipping_exports.contracts import (
    ClippingExportJobInputV1,
    ClippingExportRequestV1,
    ClippingPreviewManifestV1,
)
from server.clipping_exports.config import ClippingExportConfig
from server.clipping_exports.handler import export_object_path
from server.clipping_exports.renderer import caption_render_input, edl_arguments
from server.clipping_handoff.contracts import ServerBackedMediaDescriptorV1
from server.clipping_storage.errors import StorageError
from server.clipping_storage.local_storage import LocalMediaStorage


FIXTURE = (
    Path(__file__).parents[2]
    / "contracts"
    / "fixtures"
    / "capinsta-project-conversion-v1"
    / "valid"
    / "project-with-remapped-captions.json"
)
MIGRATION = (
    Path(__file__).parents[2]
    / "apps"
    / "web"
    / "migrations"
    / "0024_clipping_preview_exports.sql"
)
HEX = "a" * 64


def test_export_features_are_disabled_by_default(monkeypatch):
    for name in (
        "ENABLE_CLIPPING_PREVIEW_API",
        "ENABLE_CLIPPING_EXPORT_API",
        "ENABLE_CLIPPING_EXPORT_HANDLER",
    ):
        monkeypatch.delenv(name, raising=False)
    config = ClippingExportConfig.from_env()
    assert not config.preview_api_enabled
    assert not config.export_api_enabled
    assert not config.handler_enabled
    monkeypatch.setenv("CLIPPING_EXPORT_PRESET", "not-installed")
    assert not ClippingExportConfig.from_env().handler_enabled


def test_preview_contract_is_portable_and_contains_no_access_material():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    project = fixture["result"]["project"]
    manifest = ClippingPreviewManifestV1(
        previewId=UUID("00000000-0000-0000-0000-000000000001"),
        clipProjectId="clip_project_001",
        clipProjectRevision=1,
        edlResultIdentity=HEX,
        remappedTranscriptResultIdentity="b" * 64,
        conversionResultIdentity="c" * 64,
        capinstaProject=project,
        mediaAttachments=[
            ServerBackedMediaDescriptorV1(
                mediaId="media_001",
                mediaAssetId=UUID("00000000-0000-0000-0000-000000000002"),
                mediaKind="video",
                mimeType="video/mp4",
                displayName="synthetic.mp4",
                sizeBytes=100,
                durationMs=60_000,
                width=1080,
                height=1920,
            )
        ],
        durationMs=19_000,
        expiresAt=datetime(2026, 7, 26, tzinfo=timezone.utc),
        warnings=["conversion-warning"],
    )
    encoded = json.dumps(manifest.bounded_json(10_000_000))
    assert "signed" not in encoded.lower()
    assert "storagePath" not in encoded
    assert "localPath" not in encoded


def test_contracts_reject_client_controlled_export_shape_and_bad_identity():
    with pytest.raises(ValidationError):
        ClippingExportRequestV1.model_validate(
            {
                "schemaVersion": 1,
                "expectedProjectRevision": 1,
                "preset": "vertical-mp4-v1",
                "ffmpegArguments": ["-filter_complex", "evil"],
            }
        )


def test_preview_contract_rejects_signed_url_inside_project():
    with pytest.raises(ValidationError, match="private access"):
        ClippingPreviewManifestV1(
            previewId=UUID(int=1),
            clipProjectId="clip_project_001",
            clipProjectRevision=1,
            edlResultIdentity=HEX,
            remappedTranscriptResultIdentity=HEX,
            conversionResultIdentity=HEX,
            capinstaProject={
                "version": 35,
                "signedUrl": "https://example.invalid/storage/v1/object/sign/private?token=x",
            },
            mediaAttachments=[
                ServerBackedMediaDescriptorV1(
                    mediaId="media_001",
                    mediaAssetId=UUID(int=2),
                    mediaKind="video",
                    displayName="synthetic.mp4",
                    sizeBytes=1,
                    durationMs=1,
                )
            ],
            durationMs=0,
            expiresAt=datetime(2026, 7, 26, tzinfo=timezone.utc),
            warnings=[],
        )
    with pytest.raises(ValidationError):
        ClippingExportJobInputV1(
            exportId=UUID(int=1),
            clipProjectId="clip_project_001",
            expectedProjectRevision=1,
            edlResultIdentity="not-a-hash",
            remappedTranscriptResultIdentity=HEX,
            conversionResultIdentity=HEX,
            exportSpecHash=HEX,
            requestIdentity=HEX,
        )


def test_edl_adapter_honors_trim_order_and_playback_rate(tmp_path):
    edl = {
        "outputDurationMs": 900,
        "entries": [
            {
                "order": 1,
                "sourceStartMs": 1000,
                "sourceEndMs": 2000,
                "playbackRate": 2,
            },
            {
                "order": 0,
                "sourceStartMs": 0,
                "sourceEndMs": 200,
                "playbackRate": 0.5,
            },
        ],
    }
    args = edl_arguments(edl, tmp_path / "out.mp4", has_audio=True)
    graph = args[args.index("-filter_complex") + 1]
    assert "trim=start=0.000000:end=0.200000" in graph
    assert "setpts=(PTS-STARTPTS)/0.50000000" in graph
    assert "trim=start=1.000000:end=2.000000" in graph
    assert "atempo=2.00000000" in graph
    assert "concat=n=2:v=1:a=1" in graph


def test_caption_adapter_uses_converted_caption_timing_without_recalculation():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    captions_json, theme, style = caption_render_input(fixture["result"]["project"])
    captions = json.loads(captions_json)
    assert captions[0]["text"] == "hello"
    assert captions[0]["start"] == 0
    assert captions[0]["end"] == 19
    assert captions[0]["words"][0]["start"] == 0
    assert captions[0]["words"][0]["end"] == 19
    assert theme == "word_highlight_box"
    assert json.loads(style) == {}


def test_caption_adapter_preserves_existing_word_spacing_style():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    project = fixture["result"]["project"]
    project["capinstaCaptionDocuments"][0]["document"]["styleConfig"] = {
        "wordSpacing": 8
    }
    _, _, style = caption_render_input(project)
    assert json.loads(style)["wordSpacing"] == 8


def test_export_storage_path_is_deterministic_and_owner_scoped():
    value = ClippingExportJobInputV1(
        exportId=UUID("00000000-0000-0000-0000-000000000003"),
        clipProjectId="clip_project_001",
        expectedProjectRevision=4,
        edlResultIdentity=HEX,
        remappedTranscriptResultIdentity="b" * 64,
        conversionResultIdentity="c" * 64,
        exportSpecHash="d" * 64,
        requestIdentity="e" * 64,
    )
    path = export_object_path(value, UUID("00000000-0000-0000-0000-000000000004"))
    assert path == (
        "00000000-0000-0000-0000-000000000004/clip_project_001/"
        "exports/r4/dddddddddddddddd/00000000-0000-0000-0000-000000000003.mp4"
    )


def test_migration_enforces_rls_read_only_browser_and_atomic_job_link():
    sql = MIGRATION.read_text(encoding="utf-8")
    assert 'ALTER TABLE "clipping_exports" ENABLE ROW LEVEL SECURITY' in sql
    assert 'REVOKE INSERT,UPDATE,DELETE ON "clipping_exports" FROM authenticated' in sql
    assert '"clipping_exports_owner_select"' in sql
    assert '"processing_job_id" uuid NOT NULL UNIQUE' in sql
    assert '"request_identity"' in sql
    assert '"storage_path"' not in sql.split("GRANT SELECT (", 1)[1].split(") ON", 1)[0]


def test_local_storage_allows_only_managed_export_bucket(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"synthetic-output")
    checksum = __import__("hashlib").sha256(source.read_bytes()).hexdigest()
    storage = LocalMediaStorage(tmp_path / "storage")
    metadata = asyncio.run(
        storage.upload_file(
            bucket="media-exports",
            path=(
                "00000000-0000-0000-0000-000000000004/project/"
                "exports/r1/aaaaaaaaaaaaaaaa/"
                "00000000-0000-0000-0000-000000000003.mp4"
            ),
            local_path=source,
            content_type="video/mp4",
            maximum_bytes=100,
            checksum=checksum,
        )
    )
    assert metadata.size_bytes == len(b"synthetic-output")
    with pytest.raises(StorageError, match="managed output"):
        asyncio.run(
            storage.upload_file(
                bucket="source-media",
                path="owner/source.mp4",
                local_path=source,
                content_type="video/mp4",
                maximum_bytes=100,
                checksum=checksum,
            )
        )
