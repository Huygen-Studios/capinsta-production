from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


PROMPT_VERSION = "viral-candidates-v1"
ANALYSIS_SPEC = {
    "schemaVersion": 1,
    "promptVersion": PROMPT_VERSION,
    "minimumDurationMs": 20_000,
    "maximumDurationMs": 90_000,
    "maximumCandidates": 8,
    "normalizer": "shorts-domain-v1",
}
ANALYSIS_SPEC_HASH = canonical_hash(ANALYSIS_SPEC)


def stable_analysis_id(
    *,
    project_id: str,
    project_revision: int,
    transcript_id: str,
    transcript_revision: int,
    media_revision: int,
    regeneration_key: str | None = None,
) -> str:
    identity = canonical_hash(
        {
            "projectId": project_id,
            "projectRevision": project_revision,
            "transcriptId": transcript_id,
            "transcriptRevision": transcript_revision,
            "mediaRevision": media_revision,
            "analysisSpecHash": ANALYSIS_SPEC_HASH,
            "regenerationKey": regeneration_key,
        }
    )
    return f"analysis_{identity[:32]}"


def stable_candidate_id(analysis_id: str, ordinal: int) -> str:
    suffix = canonical_hash({"analysisId": analysis_id})[:12]
    return f"candidate_{suffix}_{ordinal:03d}"
