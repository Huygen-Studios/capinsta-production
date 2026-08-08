from __future__ import annotations

from pathlib import Path

from server.clipping_jobs.errors import JobOrchestrationError
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_persistence.database import DurableDatabase
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.local_storage import LocalMediaStorage
from server.clipping_storage.provider import media_storage_from_config
from server.headless_export import check_export_runtime

from .config import ClippingExportConfig
from .handler import ClippingExportJobHandler
from .repository import ClippingExportRepository


async def register_clipping_exports_if_enabled(
    registry: JobHandlerRegistry, database: DurableDatabase
) -> str | None:
    config = ClippingExportConfig.from_env()
    if not config.handler_enabled:
        return None
    health = check_export_runtime()
    if health["status"] != "ok":
        raise JobOrchestrationError(
            "worker_not_configured",
            "The enabled clipping export handler requires the existing export runtime",
        )
    if config.storage_backend == "local":
        storage = LocalMediaStorage(Path(config.local_storage_root))
        source_ttl = config.timeout_seconds + 120
        exports_bucket = "media-exports"
    else:
        storage_config = MediaStorageConfig.from_env()
        if not storage_config.enabled:
            raise JobOrchestrationError(
                "worker_not_configured",
                "Clipping exports require enabled private media storage",
            )
        source_ttl = min(
            storage_config.maximum_url_ttl_seconds,
            config.timeout_seconds + 120,
        )
        storage = media_storage_from_config(storage_config)
        exports_bucket = storage_config.exports_bucket
    registry.register(
        ClippingExportJobHandler(
            config=config,
            repository=ClippingExportRepository(database, config),
            storage=storage,
            source_ttl_seconds=source_ttl,
            exports_bucket=exports_bucket,
            storage_config=storage_config if config.storage_backend != "local" else None,
        )
    )
    return config.preset


__all__ = ["register_clipping_exports_if_enabled"]
