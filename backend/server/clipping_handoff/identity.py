from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def handoff_request_identity(
    *,
    actor_id: UUID,
    clip_project_id: str,
    clip_project_revision: int,
    conversion_result_identity: str,
    target_project_id: str,
    include_captions: bool,
) -> str:
    return canonical_hash(
        {
            "actorId": str(actor_id),
            "clipProjectId": clip_project_id,
            "clipProjectRevision": clip_project_revision,
            "conversionResultIdentity": conversion_result_identity,
            "targetProjectId": target_project_id,
            "handoffSchemaVersion": 1,
            "options": {"includeCaptions": include_captions},
        }
    )

