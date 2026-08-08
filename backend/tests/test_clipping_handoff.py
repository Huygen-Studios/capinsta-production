from datetime import datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from server.clipping_handoff.contracts import (
    CapinstaProjectHandoffManifestV1,
    ServerBackedMediaDescriptorV1,
)
from server.clipping_handoff.identity import handoff_request_identity


def _manifest():
    handoff_id = uuid4()
    asset_id = uuid4()
    target = "capinsta_target"
    project = {
        "version": 35,
        "metadata": {"id": target},
        "scenes": [
            {
                "tracks": {
                    "main": {
                        "elements": [
                            {
                                "id": "element_1",
                                "type": "video",
                                "mediaId": str(asset_id),
                            }
                        ]
                    },
                    "overlay": [],
                    "audio": [],
                }
            }
        ],
        "settings": {"canvasSize": {"width": 1080, "height": 1920}},
    }
    return {
        "schemaVersion": 1,
        "handoffId": handoff_id,
        "clipProjectId": "clip_1",
        "clipProjectRevision": 4,
        "conversionResultIdentity": "a" * 64,
        "targetProjectId": target,
        "projectSchemaVersion": 35,
        "project": project,
        "mediaAttachments": [
            ServerBackedMediaDescriptorV1(
                mediaId=str(asset_id),
                mediaAssetId=asset_id,
                mediaKind="video",
                mimeType="video/mp4",
                displayName="Synthetic source.mp4",
                durationMs=1000,
            ).model_dump(mode="json")
        ],
        "provenance": {
            "sourceClipProjectId": "clip_1",
            "sourceClipProjectRevision": 4,
            "conversionSchemaVersion": 1,
            "convertedAt": None,
        },
        "expiresAt": datetime(2030, 1, 1, tzinfo=timezone.utc),
        "warnings": [],
        "metadata": {"safe": {"provider": "test"}},
    }


def test_handoff_manifest_round_trip_is_portable_and_preserves_metadata():
    model = CapinstaProjectHandoffManifestV1.model_validate(_manifest())
    value = model.bounded_json(64 * 1024)
    assert value["metadata"] == {"safe": {"provider": "test"}}
    assert "url" not in str(value).lower()
    assert CapinstaProjectHandoffManifestV1.model_validate(value) == model


@pytest.mark.parametrize(
    "mutation",
    [
        lambda value: value["mediaAttachments"].append(
            value["mediaAttachments"][0]
        ),
        lambda value: value["mediaAttachments"].clear(),
        lambda value: value["project"]["scenes"][0]["tracks"]["main"][
            "elements"
        ][0].update({"mediaId": str(uuid4())}),
        lambda value: value["mediaAttachments"][0].update(
            {"signedUrl": "https://storage.invalid/private?token=secret"}
        ),
        lambda value: value["project"].update({"localPath": "C:\\private\\x.mp4"}),
    ],
)
def test_handoff_manifest_rejects_duplicate_missing_or_private_attachment_data(
    mutation,
):
    value = _manifest()
    mutation(value)
    with pytest.raises(ValidationError):
        CapinstaProjectHandoffManifestV1.model_validate(value)


def test_handoff_request_identity_is_deterministic_and_revision_bound():
    actor = uuid4()
    args = {
        "actor_id": actor,
        "clip_project_id": "clip_1",
        "clip_project_revision": 4,
        "conversion_result_identity": "b" * 64,
        "target_project_id": "capinsta_target",
        "include_captions": True,
    }
    identity = handoff_request_identity(**args)
    assert identity == handoff_request_identity(**args)
    assert len(identity) == 64
    assert identity != handoff_request_identity(
        **{**args, "clip_project_revision": 5}
    )
    assert identity != handoff_request_identity(
        **{**args, "target_project_id": "another_target"}
    )
