from __future__ import annotations

import asyncio
import hashlib
from contextlib import suppress
from pathlib import Path
from typing import Any, Generic, TypeVar

from pydantic import ValidationError

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext, JobExecutionResult
from server.clipping_storage.errors import StorageError
from server.clipping_storage.storage import MediaStorage
from server.media_probe.ffprobe import FFprobeRunner

from .config import MediaVariantConfig
from .contracts import (
    AudioExtractionJobInputV1,
    AudioExtractionResultV1,
    MediaVariantJobInputV1,
    ProxyGenerationJobInputV1,
    ProxyGenerationResultV1,
    ThumbnailGenerationJobInputV1,
    ThumbnailGenerationResultV1,
    VariantResultV1,
    WaveformGenerationJobInputV1,
    WaveformGenerationResultV1,
)
from .ffmpeg import FFmpegCancelled, FFmpegRunner
from .paths import variant_object_path
from .presets import generation_spec_hash, preset_spec
from .repository import MediaVariantRepository
from .verification import (
    probe_output,
    verify_audio,
    verify_proxy,
    verify_thumbnail,
    verify_waveform,
)
from .waveform import write_waveform_artifact
from .workspace import temporary_workspace

InputT = TypeVar("InputT", bound=MediaVariantJobInputV1)

_OUTPUT = {
    "proxy_generation": (
        "proxy.mp4",
        "video/mp4",
        ProxyGenerationResultV1,
    ),
    "audio_extraction": (
        "audio.wav",
        "audio/wav",
        AudioExtractionResultV1,
    ),
    "thumbnail_generation": (
        "poster.jpg",
        "image/jpeg",
        ThumbnailGenerationResultV1,
    ),
    "waveform_generation": (
        "waveform.json",
        "application/json",
        WaveformGenerationResultV1,
    ),
}


def _checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _storage_failure(error: StorageError) -> ProcessingJobFailure:
    mapping = {
        "object_not_found": (
            "source_media_not_ready",
            "The verified source object is unavailable",
            True,
        ),
        "storage_provider_unavailable": (
            "variant_upload_failed",
            "Media Storage is temporarily unavailable",
            True,
        ),
        "signed_url_failed": (
            "source_media_not_ready",
            "The source object could not be authorized",
            True,
        ),
        "storage_permission_denied": (
            "variant_upload_failed",
            "The media worker was denied Storage access",
            False,
        ),
        "object_already_exists": (
            "variant_output_conflict",
            "The deterministic variant path contains different content",
            False,
        ),
        "upload_size_invalid": (
            "ffmpeg_output_too_large",
            "The generated artifact exceeds its output limit",
            False,
        ),
        "storage_metadata_invalid": (
            "variant_verification_failed",
            "The uploaded artifact failed Storage verification",
            False,
        ),
    }
    code, message, retryable = mapping.get(
        error.category,
        ("variant_upload_failed", "The variant upload failed", True),
    )
    return ProcessingJobFailure(code, message, retryable=retryable)


class BaseVariantJobHandler(Generic[InputT]):
    job_type: str
    input_model: type[InputT]

    def __init__(
        self,
        *,
        config: MediaVariantConfig,
        storage: MediaStorage,
        repository: MediaVariantRepository,
        runner: FFmpegRunner,
        verifier_runner: FFprobeRunner,
        variants_bucket: str = "media-variants",
    ) -> None:
        self.config = config
        self.storage = storage
        self.repository = repository
        self.runner = runner
        self.verifier_runner = verifier_runner
        self.variants_bucket = variants_bucket

    def _input(self, payload: dict[str, Any]) -> InputT:
        try:
            return self.input_model.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError(
                "invalid_handler_input",
                f"The {self.job_type} input contract is invalid",
            ) from exc

    def validate_input(self, payload: dict[str, Any]) -> None:
        self._input(payload)

    def validate_output(self, payload: dict[str, Any]) -> None:
        result_class = _OUTPUT[self.job_type][2]
        try:
            result_class.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError(
                "invalid_handler_output",
                f"The {self.job_type} result contract is invalid",
            ) from exc

    def _arguments(
        self,
        job_input: InputT,
        asset: dict[str, Any],
        output_path: Path,
    ) -> tuple[str, ...]:
        raise NotImplementedError

    async def _generate(
        self,
        context: JobExecutionContext,
        job_input: InputT,
        asset: dict[str, Any],
        workspace: Path,
        output_path: Path,
    ) -> None:
        await self.runner.run(
            asset["source"],
            arguments=self._arguments(job_input, asset, output_path),
            duration_ms=asset["duration_ms"],
            timeout_seconds=self.config.timeout_for(self.job_type),
            job_timeout_seconds=context.execution_timeout_seconds,
            cancellation_check=context.cancellation_callback,
            cancellation_event=context.cancellation_event,
            lease_lost_event=context.lease_lost_event,
            stop_event=context.shutdown_event,
            progress_callback=lambda progress: context.heartbeat(
                progress=progress, current_stage="generating"
            ),
        )

    async def _technical(
        self,
        output_path: Path,
        asset: dict[str, Any],
    ) -> dict[str, Any]:
        payload = await probe_output(
            self.verifier_runner, output_path, config=self.config
        )
        if self.job_type == "proxy_generation":
            return verify_proxy(
                payload,
                source_duration_ms=asset["duration_ms"],
                expect_audio=asset["probe_output"].get("audio") is not None,
                tolerance_ms=self.config.duration_tolerance_ms,
            )
        if self.job_type == "audio_extraction":
            return verify_audio(
                payload,
                source_duration_ms=asset["duration_ms"],
                tolerance_ms=self.config.duration_tolerance_ms,
            )
        return verify_thumbnail(payload)

    async def execute(
        self, context: JobExecutionContext, payload: dict[str, Any]
    ) -> JobExecutionResult:
        job_input = self._input(payload)
        began = False
        try:
            spec = preset_spec(job_input.preset)
            if generation_spec_hash(spec) != job_input.generationSpecHash:
                raise ProcessingJobFailure(
                    "variant_spec_mismatch",
                    "The job generation specification hash is invalid",
                    retryable=False,
                )
            await context.raise_if_cancelled()
            await context.heartbeat(progress=2, current_stage="resolving_asset")
            asset = await self.repository.begin(context, job_input)
            began = True
            self._validate_streams(asset)
            await context.raise_if_cancelled()
            try:
                if asset["variant"]["status"] == "ready":
                    existing = await self.storage.inspect_object(
                        bucket=asset["variant"]["storage_bucket"],
                        path=asset["variant"]["storage_path"],
                    )
                    if existing.size_bytes != asset["variant"]["size_bytes"]:
                        raise ProcessingJobFailure(
                            "variant_output_conflict",
                            "The ready variant object no longer matches its row",
                            retryable=False,
                        )
                    _, mime_type, result_class = _OUTPUT[self.job_type]
                    metadata = dict(asset["variant"]["metadata"] or {})
                    result = result_class(
                        mediaAssetId=job_input.mediaAssetId,
                        mediaVariantId=job_input.variantId,
                        sourceMediaRevision=job_input.expectedMediaRevision,
                        sourceStorageObjectRevision=(
                            job_input.storageObjectRevision
                        ),
                        generationSpecHash=job_input.generationSpecHash,
                        storageBucket=asset["variant"]["storage_bucket"],
                        storagePath=asset["variant"]["storage_path"],
                        mimeType=asset["variant"]["mime_type"] or mime_type,
                        sizeBytes=existing.size_bytes,
                        checksum=metadata.get("checksum"),
                        durationMs=asset["variant"]["duration_ms"],
                        width=asset["variant"]["width"],
                        height=asset["variant"]["height"],
                        technicalMetadata=metadata.get("technical") or {},
                        warnings=metadata.get("warnings") or [],
                    )
                    output = await self.repository.finalize_success(
                        context, job_input, result
                    )
                    return JobExecutionResult(output=output, finalized=True)
                await self.storage.inspect_object(
                    bucket=asset["storage_bucket"],
                    path=asset["storage_path"],
                )
                source_context = self.storage.open_probe_source(
                    bucket=asset["storage_bucket"],
                    path=asset["storage_path"],
                    expires_in=self.config.signed_url_ttl_seconds,
                )
                async with source_context as source:
                    asset["source"] = source
                    async with temporary_workspace(
                        self.config.temp_root,
                        job_id=context.job_id,
                        attempt_number=context.attempt_number,
                        maximum_bytes=self.config.maximum_temp_bytes,
                    ) as workspace:
                        filename, mime_type, result_class = _OUTPUT[self.job_type]
                        output_path = workspace / filename
                        await context.heartbeat(
                            progress=5, current_stage="generating"
                        )
                        await self._generate(
                            context,
                            job_input,
                            asset,
                            workspace,
                            output_path,
                        )
                        if (
                            not output_path.is_file()
                            or output_path.stat().st_size <= 0
                        ):
                            raise ProcessingJobFailure(
                                "ffmpeg_output_missing",
                                "FFmpeg did not create the expected artifact",
                                retryable=False,
                            )
                        maximum = self.config.maximum_output_for(self.job_type)
                        if output_path.stat().st_size > maximum:
                            raise ProcessingJobFailure(
                                "ffmpeg_output_too_large",
                                "Generated artifact exceeds its output limit",
                                retryable=False,
                            )
                        await context.heartbeat(
                            progress=87, current_stage="verifying_output"
                        )
                        technical = await self._technical(output_path, asset)
                        checksum = await asyncio.to_thread(
                            _checksum, output_path
                        )
                        object_path = variant_object_path(
                            owner_user_id=asset["owner_user_id"],
                            media_asset_id=job_input.mediaAssetId,
                            variant_type=spec["variantType"],
                            source_revision=job_input.expectedMediaRevision,
                            spec_hash=job_input.generationSpecHash,
                        )
                        await self.repository.mark_stage(
                            context, job_input, "uploading"
                        )
                        await context.heartbeat(
                            progress=92, current_stage="uploading"
                        )
                        uploaded = await self.storage.upload_file(
                            bucket=self.variants_bucket,
                            path=object_path,
                            local_path=output_path,
                            content_type=mime_type,
                            maximum_bytes=maximum,
                            checksum=checksum,
                            overwrite=False,
                        )
                        if uploaded.size_bytes != output_path.stat().st_size:
                            raise ProcessingJobFailure(
                                "variant_verification_failed",
                                "Uploaded artifact size differs from local output",
                                retryable=False,
                            )
                        await self.repository.mark_stage(
                            context, job_input, "verifying"
                        )
                        await context.heartbeat(
                            progress=97, current_stage="finalizing"
                        )
                        result: VariantResultV1 = result_class(
                            mediaAssetId=job_input.mediaAssetId,
                            mediaVariantId=job_input.variantId,
                            sourceMediaRevision=job_input.expectedMediaRevision,
                            sourceStorageObjectRevision=(
                                job_input.storageObjectRevision
                            ),
                            generationSpecHash=job_input.generationSpecHash,
                            storageBucket=self.variants_bucket,
                            storagePath=object_path,
                            mimeType=mime_type,
                            sizeBytes=uploaded.size_bytes,
                            checksum=checksum,
                            durationMs=technical.get("durationMs"),
                            width=technical.get("width"),
                            height=technical.get("height"),
                            technicalMetadata=technical,
                            warnings=[],
                        )
                        output = await self.repository.finalize_success(
                            context, job_input, result
                        )
                        return JobExecutionResult(
                            output=output, finalized=True
                        )
            except StorageError as exc:
                raise _storage_failure(exc) from exc
        except FFmpegCancelled:
            if began:
                await self.repository.release_after_cancellation(
                    context, job_input
                )
            raise asyncio.CancelledError
        except asyncio.CancelledError:
            if began and context.cancellation_event.is_set():
                with suppress(JobOrchestrationError):
                    await self.repository.release_after_cancellation(
                        context, job_input
                    )
            raise
        except ProcessingJobFailure as exc:
            terminal = (
                not exc.retryable
                or context.attempt_number >= context.maximum_attempts
            )
            if began and terminal:
                await self.repository.finalize_permanent_failure(
                    context, job_input, exc
                )
                raise ProcessingJobFailure(
                    exc.code,
                    exc.safe_message,
                    retryable=False,
                    details=exc.details,
                    finalized=True,
                ) from exc
            raise

    def _validate_streams(self, asset: dict[str, Any]) -> None:
        del asset


class ProxyGenerationJobHandler(
    BaseVariantJobHandler[ProxyGenerationJobInputV1]
):
    job_type = "proxy_generation"
    input_model = ProxyGenerationJobInputV1

    def _validate_streams(self, asset: dict[str, Any]) -> None:
        if asset["probe_output"].get("video") is None:
            raise ProcessingJobFailure(
                "proxy_unsupported_for_audio",
                "A video proxy cannot be generated for audio-only media",
                retryable=False,
            )

    def _arguments(
        self,
        job_input: ProxyGenerationJobInputV1,
        asset: dict[str, Any],
        output_path: Path,
    ) -> tuple[str, ...]:
        del job_input
        probe = asset["probe_output"]
        args = [
            "-map",
            f"0:{probe['video']['streamIndex']}",
        ]
        if probe.get("audio") is not None:
            args.extend(["-map", f"0:{probe['audio']['streamIndex']}"])
        args.extend(
            [
                "-map_metadata",
                "-1",
                "-vf",
                "scale='min(1280,iw)':'min(720,ih)':"
                "force_original_aspect_ratio=decrease:force_divisible_by=2",
                "-c:v",
                "libx264",
                "-b:v",
                "2500k",
                "-maxrate",
                "2500k",
                "-bufsize",
                "5000k",
                "-pix_fmt",
                "yuv420p",
            ]
        )
        if probe.get("audio") is not None:
            args.extend(
                [
                    "-c:a",
                    "aac",
                    "-b:a",
                    "128k",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                ]
            )
        else:
            args.append("-an")
        args.extend(["-movflags", "+faststart", str(output_path)])
        return tuple(args)


class AudioExtractionJobHandler(
    BaseVariantJobHandler[AudioExtractionJobInputV1]
):
    job_type = "audio_extraction"
    input_model = AudioExtractionJobInputV1

    def _validate_streams(self, asset: dict[str, Any]) -> None:
        if asset["probe_output"].get("audio") is None:
            raise ProcessingJobFailure(
                "audio_stream_missing",
                "The source media has no audio stream",
                retryable=False,
            )

    def _arguments(
        self,
        job_input: AudioExtractionJobInputV1,
        asset: dict[str, Any],
        output_path: Path,
    ) -> tuple[str, ...]:
        del job_input
        return (
            "-map",
            f"0:{asset['probe_output']['audio']['streamIndex']}",
            "-map_metadata",
            "-1",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(output_path),
        )


class ThumbnailGenerationJobHandler(
    BaseVariantJobHandler[ThumbnailGenerationJobInputV1]
):
    job_type = "thumbnail_generation"
    input_model = ThumbnailGenerationJobInputV1

    def _validate_streams(self, asset: dict[str, Any]) -> None:
        if asset["probe_output"].get("video") is None:
            raise ProcessingJobFailure(
                "thumbnail_unsupported_for_audio",
                "A poster thumbnail cannot be generated for audio-only media",
                retryable=False,
            )

    def _arguments(
        self,
        job_input: ThumbnailGenerationJobInputV1,
        asset: dict[str, Any],
        output_path: Path,
    ) -> tuple[str, ...]:
        duration_ms = asset["duration_ms"]
        requested = min(duration_ms // 10, 5000)
        if duration_ms > 0:
            requested = min(requested, max(0, duration_ms - 1))
        return (
            "-map",
            f"0:{asset['probe_output']['video']['streamIndex']}",
            "-ss",
            f"{requested / 1000:.3f}",
            "-frames:v",
            "1",
            "-map_metadata",
            "-1",
            "-vf",
            "scale='min(640,iw)':-2",
            "-q:v",
            "3",
            "-f",
            "image2",
            str(output_path),
        )


class WaveformGenerationJobHandler(
    BaseVariantJobHandler[WaveformGenerationJobInputV1]
):
    job_type = "waveform_generation"
    input_model = WaveformGenerationJobInputV1

    def _validate_streams(self, asset: dict[str, Any]) -> None:
        if asset["probe_output"].get("audio") is None:
            raise ProcessingJobFailure(
                "audio_stream_missing",
                "The source media has no audio stream",
                retryable=False,
            )

    def _arguments(
        self,
        job_input: WaveformGenerationJobInputV1,
        asset: dict[str, Any],
        output_path: Path,
    ) -> tuple[str, ...]:
        del job_input, output_path
        raise NotImplementedError

    async def _generate(
        self,
        context: JobExecutionContext,
        job_input: WaveformGenerationJobInputV1,
        asset: dict[str, Any],
        workspace: Path,
        output_path: Path,
    ) -> None:
        pcm_path = workspace / "waveform.pcm"
        await self.runner.run(
            asset["source"],
            arguments=(
                "-map",
                f"0:{asset['probe_output']['audio']['streamIndex']}",
                "-map_metadata",
                "-1",
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                "-f",
                "s16le",
                str(pcm_path),
            ),
            duration_ms=asset["duration_ms"],
            timeout_seconds=self.config.waveform_timeout_seconds,
            job_timeout_seconds=context.execution_timeout_seconds,
            cancellation_check=context.cancellation_callback,
            cancellation_event=context.cancellation_event,
            lease_lost_event=context.lease_lost_event,
            stop_event=context.shutdown_event,
            progress_callback=lambda progress: context.heartbeat(
                progress=progress, current_stage="decoding_waveform"
            ),
        )
        if (
            not pcm_path.is_file()
            or pcm_path.stat().st_size > self.config.maximum_temp_bytes
        ):
            raise ProcessingJobFailure(
                "temporary_disk_limit_exceeded",
                "Decoded waveform PCM exceeds its temporary disk limit",
                retryable=False,
            )
        await asyncio.to_thread(
            write_waveform_artifact,
            pcm_path,
            output_path,
            media_asset_id=job_input.mediaAssetId,
            source_revision=job_input.expectedMediaRevision,
            duration_ms=asset["duration_ms"],
            bucket_duration_ms=self.config.waveform_bucket_duration_ms,
            maximum_peaks=self.config.waveform_max_peaks,
        )

    async def _technical(
        self, output_path: Path, asset: dict[str, Any]
    ) -> dict[str, Any]:
        artifact = verify_waveform(
            output_path,
            source_duration_ms=asset["duration_ms"],
            maximum_peaks=self.config.waveform_max_peaks,
            maximum_bytes=self.config.waveform_max_output_bytes,
        )
        return {
            "durationMs": artifact.durationMs,
            "sampleRateHz": artifact.sampleRateHz,
            "channelMode": artifact.channelMode,
            "bucketDurationMs": artifact.bucketDurationMs,
            "peakEncoding": artifact.peakEncoding,
            "peakCount": len(artifact.peaks),
        }


__all__ = [
    "AudioExtractionJobHandler",
    "ProxyGenerationJobHandler",
    "ThumbnailGenerationJobHandler",
    "WaveformGenerationJobHandler",
]
