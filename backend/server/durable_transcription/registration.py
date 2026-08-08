from __future__ import annotations

import os
from pathlib import Path

from ai_pipeline.transcriber import is_real_secret
from server.clipping_jobs.errors import JobOrchestrationError
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_persistence.database import DurableDatabase
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.local_storage import LocalMediaStorage
from server.clipping_storage.provider import media_storage_from_config
from server.transcription_catalog import (
    catalog_entry,
    model_runtime_availability,
)
from server.transcription_control import active_transcription_config

from .config import DurableTranscriptionConfig
from .handler import TranscriptionJobHandler
from .repository import DurableTranscriptionRepository


async def register_durable_transcription_if_enabled(
    registry: JobHandlerRegistry,
    database: DurableDatabase,
) -> tuple[str, str] | None:
    config = DurableTranscriptionConfig.from_env()
    if not config.enabled:
        return None
    snapshot = active_transcription_config()
    if snapshot is None:
        raise JobOrchestrationError(
            "worker_not_configured",
            "Durable transcription requires one active provider configuration",
        )
    entry = catalog_entry(snapshot.provider, snapshot.model)
    if entry is None:
        raise JobOrchestrationError(
            "worker_not_configured",
            "The active transcription provider/model is unsupported",
        )
    if not is_real_secret(os.getenv(entry.required_secret)):
        raise JobOrchestrationError(
            "worker_not_configured",
            "The active transcription provider credential is unavailable",
        )
    availability = model_runtime_availability(entry)
    if not availability.get("productionReady"):
        raise JobOrchestrationError(
            "worker_not_configured",
            "The active transcription provider is unavailable at runtime",
        )
    if config.storage_backend == "local":
        storage = LocalMediaStorage(Path(config.local_storage_root))
    else:
        storage_config = MediaStorageConfig.from_env()
        if not storage_config.enabled:
            raise JobOrchestrationError(
                "worker_not_configured",
                "Durable transcription requires enabled private media storage",
            )
        if (
            config.source_url_ttl_seconds
            > storage_config.maximum_url_ttl_seconds
        ):
            raise JobOrchestrationError(
                "worker_not_configured",
                "Transcription URL TTL exceeds the Storage maximum",
            )
        storage = media_storage_from_config(storage_config)
    registry.register(
        TranscriptionJobHandler(
            config=config,
            storage=storage,
            storage_config=storage_config if config.storage_backend != "local" else None,
            repository=DurableTranscriptionRepository(database),
            configuration_snapshot=snapshot,
        )
    )
    return snapshot.provider, snapshot.model


__all__ = ["register_durable_transcription_if_enabled"]
