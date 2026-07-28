from __future__ import annotations

import hashlib
import json
from typing import Any

from .contracts import TranscriptionJobInputV1


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def transcription_request_identity(
    *,
    media_asset_id: Any,
    media_revision: int,
    storage_object_revision: int,
    audio_variant_id: Any,
    audio_variant_revision: int,
    language_mode: str,
    provider_preference: str | None,
    hotwords: list[str],
    options: dict[str, Any],
) -> str:
    return canonical_hash(
        {
            "schemaVersion": 1,
            "mediaAssetId": str(media_asset_id),
            "mediaRevision": media_revision,
            "storageObjectRevision": storage_object_revision,
            "audioVariantId": str(audio_variant_id),
            "audioVariantRevision": audio_variant_revision,
            "languageMode": language_mode,
            "providerPreference": provider_preference,
            "hotwords": hotwords,
            "options": options,
        }
    )


def validate_request_identity(job_input: TranscriptionJobInputV1) -> None:
    expected = transcription_request_identity(
        media_asset_id=job_input.mediaAssetId,
        media_revision=job_input.expectedMediaRevision,
        storage_object_revision=job_input.storageObjectRevision,
        audio_variant_id=job_input.audioVariantId,
        audio_variant_revision=job_input.audioVariantRevision,
        language_mode=job_input.languageMode,
        provider_preference=job_input.providerPreference,
        hotwords=job_input.hotwords,
        options=job_input.options.model_dump(mode="json"),
    )
    if expected != job_input.requestIdentity:
        raise ValueError("requestIdentity does not match the transcription input")


def transcript_result_identity(document: dict[str, Any]) -> str:
    semantic = dict(document)
    semantic.pop("createdAt", None)
    semantic.pop("updatedAt", None)
    return canonical_hash(semantic)


__all__ = [
    "canonical_hash",
    "transcript_result_identity",
    "transcription_request_identity",
    "validate_request_identity",
]
