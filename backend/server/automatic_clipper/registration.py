from __future__ import annotations

from server.clipping_jobs.errors import JobOrchestrationError
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_persistence.database import DurableDatabase
from server.clipping_runtime.client import ClippingRuntimeClient
from server.clipping_runtime.config import ClippingRuntimeConfig
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.local_storage import LocalMediaStorage
from server.clipping_storage.provider import media_storage_from_config

from .config import AutomaticClipperConfig
from .handlers import SmartReframeJobHandler, ViralCandidateAnalysisJobHandler
from .repository import AutomaticClipperRepository


async def register_automatic_clipper_if_enabled(
    registry: JobHandlerRegistry, database: DurableDatabase
) -> tuple[str, ...] | None:
    config = AutomaticClipperConfig.from_env()
    if not config.candidate_analysis_enabled and not config.smart_reframe_enabled:
        return None
    runtime = ClippingRuntimeClient(ClippingRuntimeConfig.from_env())
    version = await runtime.version()
    required = {
        "analyze_candidates"
        if config.candidate_analysis_enabled
        else None,
        "compose_short" if config.smart_reframe_enabled else None,
        "plan_reframe" if config.smart_reframe_enabled else None,
    } - {None}
    if not required <= set(version.operations):
        raise JobOrchestrationError(
            "worker_not_configured",
            "The clipping runtime does not support automatic clipper operations",
        )
    repository = AutomaticClipperRepository(database)
    registered: list[str] = []
    if config.candidate_analysis_enabled:
        registry.register(
            ViralCandidateAnalysisJobHandler(
                config=config, repository=repository, runtime=runtime
            )
        )
        registered.append("viral_candidate_analysis")
    if config.smart_reframe_enabled:
        storage_config = MediaStorageConfig.from_env()
        if config.storage_backend == "local":
            storage = LocalMediaStorage(config.local_storage_root)
            source_ttl = config.reframe_timeout_seconds + 120
        else:
            if not storage_config.enabled:
                raise JobOrchestrationError(
                    "worker_not_configured",
                    "Smart framing requires enabled private media storage",
                )
            storage = media_storage_from_config(storage_config)
            source_ttl = min(
                storage_config.maximum_url_ttl_seconds,
                config.reframe_timeout_seconds + 120,
            )
        registry.register(
            SmartReframeJobHandler(
                config=config,
                repository=repository,
                runtime=runtime,
                storage=storage,
                source_ttl_seconds=source_ttl,
                storage_config=storage_config if config.storage_backend != "local" else None,
            )
        )
        registered.append("smart_reframe")
    return tuple(registered)


__all__ = ["register_automatic_clipper_if_enabled"]
