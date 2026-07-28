from __future__ import annotations

import re
from uuid import UUID

from server.clipping_storage.errors import StorageError

_FILES = {
    "proxy": "proxy.mp4",
    "audio_extract": "audio.wav",
    "thumbnail": "poster.jpg",
    "waveform": "waveform.json",
}
_HASH = re.compile(r"^[0-9a-f]{64}$")


def variant_object_path(
    *,
    owner_user_id: UUID,
    media_asset_id: UUID,
    variant_type: str,
    source_revision: int,
    spec_hash: str,
) -> str:
    if variant_type not in _FILES or source_revision < 1 or not _HASH.fullmatch(
        spec_hash
    ):
        raise StorageError(
            "object_path_invalid", "Media-variant object identity is invalid"
        )
    return (
        f"{owner_user_id}/{media_asset_id}/variants/{variant_type}/"
        f"r{source_revision}/{spec_hash[:12]}/{_FILES[variant_type]}"
    )


__all__ = ["variant_object_path"]
