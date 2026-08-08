from __future__ import annotations

from server.clipping_jobs.errors import JobOrchestrationError
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_persistence.database import DurableDatabase

from .client import ClippingRuntimeClient
from .config import ClippingRuntimeConfig
from .errors import ClippingRuntimeError
from .handlers import ProjectConversionJobHandler, ProjectDerivationJobHandler
from .repository import ClippingRuntimeRepository


async def register_clipping_runtime_if_enabled(
    registry: JobHandlerRegistry, database: DurableDatabase
) -> tuple[str, tuple[str, ...]] | None:
    config = ClippingRuntimeConfig.from_env()
    try:
        config.validate_handler_flags()
    except ValueError as exc:
        raise JobOrchestrationError(
            "clipping_runtime_disabled", "Clipping runtime configuration is invalid"
        ) from exc
    if not (
        config.derivation_handler_enabled or config.conversion_handler_enabled
    ):
        return None
    client = ClippingRuntimeClient(config)
    try:
        version = await client.version()
        health = await client.health()
    except ClippingRuntimeError as exc:
        raise JobOrchestrationError(
            "clipping_runtime_incompatible", exc.safe_message
        ) from exc
    if (
        config.protocol_version not in version.protocolVersions
        or health.status != "healthy"
    ):
        raise JobOrchestrationError(
            "clipping_runtime_incompatible",
            "The clipping runtime protocol is incompatible",
        )
    required = set()
    if config.derivation_handler_enabled:
        required.add("derive_project")
    if config.conversion_handler_enabled:
        required.add("convert_project")
    if not required <= set(version.operations):
        raise JobOrchestrationError(
            "clipping_runtime_incompatible",
            "The clipping runtime does not support the enabled handlers",
        )
    repository = ClippingRuntimeRepository(database)
    registered: list[str] = []
    if config.derivation_handler_enabled:
        registry.register(
            ProjectDerivationJobHandler(
                config=config, client=client, repository=repository
            )
        )
        registered.append("project_derivation")
    if config.conversion_handler_enabled:
        registry.register(
            ProjectConversionJobHandler(
                config=config, client=client, repository=repository
            )
        )
        registered.append("project_conversion")
    return version.runtimeVersion, tuple(registered)


__all__ = ["register_clipping_runtime_if_enabled"]
