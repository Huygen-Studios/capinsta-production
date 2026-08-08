from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def derivation_result_identity(
    *,
    project_id: str,
    project_revision: int,
    transcript_id: str,
    transcript_revision: int,
    media_revision: int,
    include_remapped_transcript: bool,
    result: dict[str, Any],
) -> str:
    return canonical_hash(
        {
            "projectId": project_id,
            "projectRevision": project_revision,
            "transcriptId": transcript_id,
            "transcriptRevision": transcript_revision,
            "mediaRevision": media_revision,
            "edlSchemaVersion": 1,
            "includeRemappedTranscript": include_remapped_transcript,
            "resultHash": canonical_hash(result),
        }
    )


def conversion_result_identity(
    *,
    project_id: str,
    project_revision: int,
    edl_identity: str,
    remapped_identity: str | None,
    target_project_id: str,
    include_captions: bool,
    result: dict[str, Any],
) -> str:
    return canonical_hash(
        {
            "projectId": project_id,
            "projectRevision": project_revision,
            "edlIdentity": edl_identity,
            "remappedTranscriptIdentity": remapped_identity,
            "targetProjectId": target_project_id,
            "includeCaptions": include_captions,
            "conversionSchemaVersion": 1,
            "resultHash": canonical_hash(result),
        }
    )
