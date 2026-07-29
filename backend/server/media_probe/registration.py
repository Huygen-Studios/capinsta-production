from __future__ import annotations

from pathlib import Path

from server.clipping_jobs.errors import JobOrchestrationError
from server.clipping_jobs.policies import DEFAULT_JOB_POLICIES
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_persistence.database import DurableDatabase
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.local_storage import LocalMediaStorage
from server.clipping_storage.provider import media_storage_from_config

from .config import MediaProbeConfig
from .ffprobe import FFprobeRunner
from .handler import MediaProbeJobHandler
from .repository import MediaProbeRepository


async def register_media_probe_if_enabled(
    registry: JobHandlerRegistry,
    database: DurableDatabase,
) -> str | None:
    policy = DEFAULT_JOB_POLICIES["media_probe"]
    config = MediaProbeConfig.from_env(
        job_timeout_seconds=policy.default_timeout_seconds
    )
    if not config.enabled:
        return None
    if config.storage_backend == "local":
        storage = LocalMediaStorage(Path(config.local_storage_root))
    else:
        storage_config = MediaStorageConfig.from_env()
        if not storage_config.enabled:
            raise JobOrchestrationError(
                "worker_not_configured",
                "The media-probe handler requires enabled private media storage",
            )
        if (
            config.signed_url_ttl_seconds
            > storage_config.maximum_url_ttl_seconds
        ):
            raise JobOrchestrationError(
                "worker_not_configured",
                "Media probe signed URL TTL exceeds the storage maximum",
            )
        storage = media_storage_from_config(storage_config)
    runner = FFprobeRunner(config)
    version = await runner.validate_available()
    registry.register(
        MediaProbeJobHandler(
            config=config,
            storage=storage,
            storage_config=storage_config if config.storage_backend != "local" else None,
            repository=MediaProbeRepository(database),
            runner=runner,
        )
    )
    return version


__all__ = ["register_media_probe_if_enabled"]
