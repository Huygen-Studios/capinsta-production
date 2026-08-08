from __future__ import annotations

from pathlib import Path

from server.clipping_jobs.errors import JobOrchestrationError
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_persistence.database import DurableDatabase
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.local_storage import LocalMediaStorage
from server.clipping_storage.provider import media_storage_from_config

from .config import TranscriptAnalysisConfig
from .handlers import SilenceAnalysisJobHandler, TranscriptAnalysisJobHandler
from .repository import TranscriptAnalysisRepository
from .silence import SilenceFFmpegRunner


async def register_transcript_analysis_if_enabled(
    registry: JobHandlerRegistry,
    database: DurableDatabase,
) -> tuple[str, ...] | None:
    config = TranscriptAnalysisConfig.from_env()
    if not config.handlers_enabled:
        return None
    repository = TranscriptAnalysisRepository(database)
    registered: list[str] = []
    if "transcript_analysis" in config.job_types:
        registry.register(
            TranscriptAnalysisJobHandler(config=config, repository=repository)
        )
        registered.append("transcript_analysis")
    if "silence_analysis" in config.job_types:
        if config.storage_backend == "local":
            storage = LocalMediaStorage(Path(config.local_storage_root))
        else:
            storage_config = MediaStorageConfig.from_env()
            if not storage_config.enabled:
                raise JobOrchestrationError(
                    "worker_not_configured",
                    "Silence analysis requires enabled private media storage",
                )
            storage = media_storage_from_config(storage_config)
        runner = SilenceFFmpegRunner(
            config.ffmpeg_path,
            maximum_stderr_bytes=config.maximum_stderr_bytes,
        )
        version = await runner.validate_available()
        registry.register(
            SilenceAnalysisJobHandler(
                config=config,
                storage=storage,
                storage_config=storage_config if config.storage_backend != "local" else None,
                repository=repository,
                runner=runner,
            )
        )
        registered.append(f"silence_analysis:{version}")
    return tuple(registered)


__all__ = ["register_transcript_analysis_if_enabled"]
