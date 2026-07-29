from __future__ import annotations

from pathlib import Path

from .config import MediaStorageConfig
from .local_storage import LocalMediaStorage
from .r2_storage import R2MediaStorage
from .storage import MediaStorage
from .supabase_storage import SupabaseMediaStorage


def media_storage_from_config(config: MediaStorageConfig) -> MediaStorage:
    return media_storage_for_provider(config.storage_provider, config)


def media_storage_for_provider(
    provider: str | None, config: MediaStorageConfig
) -> MediaStorage:
    provider = (provider or "supabase").strip().lower()
    if config.storage_provider == "local":
        provider = "local"
    if provider == "local":
        return LocalMediaStorage(Path(config.local_storage_root))
    if provider == "r2":
        return R2MediaStorage(config)
    return SupabaseMediaStorage(config)
