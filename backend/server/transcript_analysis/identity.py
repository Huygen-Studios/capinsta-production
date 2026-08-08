from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_hash(value: Any) -> str:
    payload = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def analysis_identity(
    *,
    media_asset_id: Any,
    media_revision: int,
    transcript_id: str,
    transcript_revision: int,
    analysis_type: str,
    spec_hash: str,
    audio_variant_id: Any | None = None,
    audio_variant_revision: int | None = None,
) -> str:
    return canonical_hash(
        {
            "schemaVersion": 1,
            "mediaAssetId": str(media_asset_id),
            "mediaRevision": media_revision,
            "transcriptId": transcript_id,
            "transcriptRevision": transcript_revision,
            "analysisType": analysis_type,
            "analysisSpecHash": spec_hash,
            "audioVariantId": (
                str(audio_variant_id) if audio_variant_id is not None else None
            ),
            "audioVariantRevision": audio_variant_revision,
        }
    )


def result_identity(
    document: dict[str, Any], recommendations: list[dict[str, Any]]
) -> str:
    return canonical_hash(
        {"document": document, "recommendations": recommendations}
    )


def stable_id(prefix: str, value: Any) -> str:
    return f"{prefix}_{canonical_hash(value)[:32]}"


__all__ = [
    "analysis_identity",
    "canonical_hash",
    "result_identity",
    "stable_id",
]
