from __future__ import annotations

from pathlib import Path

from server.clipping_jobs.errors import JobOrchestrationError
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_persistence.database import DurableDatabase
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.local_storage import LocalMediaStorage
from server.clipping_storage.supabase_storage import SupabaseMediaStorage
from server.media_probe.config import MediaProbeConfig
from server.media_probe.ffprobe import FFprobeRunner

from .config import MediaVariantConfig
from .ffmpeg import FFmpegRunner
from .handlers import (
    AudioExtractionJobHandler,
    ProxyGenerationJobHandler,
    ThumbnailGenerationJobHandler,
    WaveformGenerationJobHandler,
)
from .repository import MediaVariantRepository

_HANDLERS = {
    "proxy_generation": ProxyGenerationJobHandler,
    "audio_extraction": AudioExtractionJobHandler,
    "thumbnail_generation": ThumbnailGenerationJobHandler,
    "waveform_generation": WaveformGenerationJobHandler,
}


async def register_media_variants_if_enabled(
    registry: JobHandlerRegistry,
    database: DurableDatabase,
) -> tuple[str, str] | None:
    config = MediaVariantConfig.from_env()
    if not config.enabled:
        return None
    if config.storage_backend == "local":
        storage = LocalMediaStorage(Path(config.local_storage_root))
        variants_bucket = "media-variants"
    else:
        storage_config = MediaStorageConfig.from_env()
        if not storage_config.enabled:
            raise JobOrchestrationError(
                "worker_not_configured",
                "Media-variant handlers require enabled Supabase media storage",
            )
        if config.signed_url_ttl_seconds > (
            storage_config.maximum_url_ttl_seconds
        ):
            raise JobOrchestrationError(
                "worker_not_configured",
                "Variant signed URL TTL exceeds the Storage maximum",
            )
        storage = SupabaseMediaStorage(storage_config)
        variants_bucket = storage_config.variants_bucket
    runner = FFmpegRunner(config)
    ffmpeg_version = await runner.validate_available()
    verifier = FFprobeRunner(
        MediaProbeConfig(
            enabled=True,
            ffprobe_binary=config.ffprobe_binary,
            timeout_seconds=45,
            signed_url_ttl_seconds=120,
            signed_url_safety_seconds=10,
        )
    )
    ffprobe_version = await verifier.validate_available()
    repository = MediaVariantRepository(database)
    for job_type in config.enabled_job_types:
        registry.register(
            _HANDLERS[job_type](
                config=config,
                storage=storage,
                repository=repository,
                runner=runner,
                verifier_runner=verifier,
                variants_bucket=variants_bucket,
            )
        )
    return ffmpeg_version, ffprobe_version


__all__ = ["register_media_variants_if_enabled"]
