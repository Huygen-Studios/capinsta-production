from __future__ import annotations

import asyncio
import hashlib
import json
import re
from contextlib import suppress
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from server.clipping_jobs.errors import (
    JobOrchestrationError,
    ProcessingJobFailure,
)
from server.clipping_jobs.models import JobExecutionContext, JobExecutionResult
from server.clipping_storage.errors import StorageError
from server.clipping_storage.models import ProbeSource
from server.media_probe.config import MediaProbeConfig
from server.media_probe.ffprobe import FFprobeRunner
from server.media_variants.workspace import temporary_workspace

from .config import ClippingExportConfig
from .contracts import ClippingExportJobInputV1
from .renderer import render_project
from .repository import ClippingExportRepository


def export_object_path(value: ClippingExportJobInputV1, owner_user_id) -> str:
    project_segment = value.clipProjectId
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,200}", project_segment):
        project_segment = hashlib.sha256(project_segment.encode("utf-8")).hexdigest()[
            :32
        ]
    return (
        f"{owner_user_id}/{project_segment}/exports/"
        f"r{value.expectedProjectRevision}/{value.exportSpecHash[:16]}/{value.exportId}.mp4"
    )


def _checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


async def verify_output(
    path: Path,
    *,
    expected_duration_ms: int,
    expected_width: int,
    expected_height: int,
    expect_audio: bool,
    timeout_seconds: int,
) -> dict[str, Any]:
    source = ProbeSource(
        kind="local_path",
        value=str(path),
        expires_at=None,
        redacted_display="[temporary-export]",
    )

    async def never() -> bool:
        return False

    runner = FFprobeRunner(
        MediaProbeConfig(
            enabled=True,
            timeout_seconds=min(45, max(1, timeout_seconds - 1)),
        )
    )
    raw = await runner.run(
        source,
        job_timeout_seconds=timeout_seconds,
        cancellation_check=never,
        cancellation_event=asyncio.Event(),
        lease_lost_event=asyncio.Event(),
        stop_event=asyncio.Event(),
    )
    payload = json.loads(raw)
    streams = payload.get("streams") or []
    videos = [item for item in streams if item.get("codec_type") == "video"]
    audios = [item for item in streams if item.get("codec_type") == "audio"]
    format_value = payload.get("format") or {}
    try:
        duration_ms = round(float(format_value.get("duration")) * 1000)
    except (TypeError, ValueError) as exc:
        raise ProcessingJobFailure(
            "export_verification_failed",
            "Rendered duration is invalid",
            retryable=False,
        ) from exc
    if (
        "mp4" not in str(format_value.get("format_name") or "")
        or len(videos) != 1
        or videos[0].get("codec_name") != "h264"
        or int(videos[0].get("width") or 0) != expected_width
        or int(videos[0].get("height") or 0) != expected_height
        or abs(duration_ms - expected_duration_ms) > 1000
        or (expect_audio and (len(audios) != 1 or audios[0].get("codec_name") != "aac"))
        or (not expect_audio and audios)
    ):
        raise ProcessingJobFailure(
            "export_verification_failed",
            "Rendered output does not match the export preset",
            retryable=False,
        )
    return {
        "durationMs": duration_ms,
        "width": expected_width,
        "height": expected_height,
        "videoCodec": "h264",
        "audioCodec": "aac" if audios else None,
    }


class ClippingExportJobHandler:
    job_type = "clip_export"

    def __init__(
        self, *, config, repository, storage, source_ttl_seconds, exports_bucket
    ):
        self.config: ClippingExportConfig = config
        self.repository: ClippingExportRepository = repository
        self.storage = storage
        self.source_ttl_seconds = source_ttl_seconds
        self.exports_bucket = exports_bucket

    @staticmethod
    def _input(payload) -> ClippingExportJobInputV1:
        try:
            return ClippingExportJobInputV1.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError(
                "invalid_handler_input", "Clipping export job input is invalid"
            ) from exc

    def validate_input(self, payload: dict[str, Any]) -> None:
        self._input(payload)

    @staticmethod
    def validate_output(payload: dict[str, Any]) -> None:
        if set(payload) != {
            "exportId",
            "projectId",
            "projectRevision",
            "resultIdentity",
            "sizeBytes",
            "durationMs",
            "width",
            "height",
        }:
            raise JobOrchestrationError(
                "invalid_handler_output", "Clipping export output is invalid"
            )

    async def execute(self, context: JobExecutionContext, payload: dict[str, Any]):
        value = self._input(payload)
        began = False
        try:
            await context.raise_if_cancelled()
            await context.heartbeat(progress=5, current_stage="loading_project")
            target = await self.repository.begin_render(context, value)
            began = True
            if target["ready"]:
                raise ProcessingJobFailure(
                    "export_result_conflict",
                    "A ready export was unexpectedly queued again",
                    retryable=False,
                )
            asset = target["asset"]
            expected_audio = bool(
                ((asset.get("metadata") or {}).get("probe") or {}).get("audioCodec")
            )
            await context.raise_if_cancelled()
            await context.heartbeat(progress=10, current_stage="resolving_media")
            async with self.storage.open_probe_source(
                bucket=asset["storage_bucket"],
                path=asset["storage_path"],
                expires_in=self.source_ttl_seconds,
            ) as source:
                async with temporary_workspace(
                    self.config.temp_root,
                    job_id=context.job_id,
                    attempt_number=context.attempt_number,
                    maximum_bytes=self.config.maximum_output_bytes * 2,
                ) as workspace:
                    await context.raise_if_cancelled()
                    output_path = await render_project(
                        context=context,
                        source=source,
                        edl=target["edl"],
                        converted_project=target["convertedProject"],
                        workspace=workspace,
                        maximum_output_bytes=self.config.maximum_output_bytes,
                        timeout_seconds=self.config.timeout_seconds,
                    )
                    await self.repository.mark_worker_stage(context, value, "verifying")
                    await context.heartbeat(progress=86, current_stage="verifying")
                    canvas = target["convertedProject"]["settings"]["canvasSize"]
                    technical = await verify_output(
                        output_path,
                        expected_duration_ms=target["edl"]["outputDurationMs"],
                        expected_width=canvas["width"],
                        expected_height=canvas["height"],
                        expect_audio=expected_audio,
                        timeout_seconds=context.execution_timeout_seconds,
                    )
                    checksum = await asyncio.to_thread(_checksum, output_path)
                    storage_path = export_object_path(value, asset["owner_user_id"])
                    await context.raise_if_cancelled()
                    await self.repository.mark_worker_stage(context, value, "uploading")
                    await context.heartbeat(progress=93, current_stage="uploading")
                    uploaded = await self.storage.upload_file(
                        bucket=self.exports_bucket,
                        path=storage_path,
                        local_path=output_path,
                        content_type="video/mp4",
                        maximum_bytes=self.config.maximum_output_bytes,
                        checksum=checksum,
                        overwrite=False,
                    )
                    if uploaded.size_bytes != output_path.stat().st_size:
                        raise ProcessingJobFailure(
                            "export_upload_invalid",
                            "Uploaded export size differs from the verified output",
                            retryable=False,
                        )
                    await context.raise_if_cancelled()
                    await context.heartbeat(progress=98, current_stage="finalizing")
                    finalized = await self.repository.finalize_success(
                        context,
                        value,
                        {
                            "storageBucket": self.exports_bucket,
                            "storagePath": storage_path,
                            "mimeType": "video/mp4",
                            "sizeBytes": uploaded.size_bytes,
                            "checksum": checksum,
                            **technical,
                        },
                    )
                    return JobExecutionResult(output=finalized, finalized=True)
        except StorageError as exc:
            retryable = exc.category in {
                "storage_provider_unavailable",
                "signed_url_failed",
            }
            failure = ProcessingJobFailure(
                "export_storage_unavailable" if retryable else "export_storage_invalid",
                "Clipping export Storage operation failed",
                retryable=retryable,
            )
            if began and not retryable:
                await self.repository.finalize_permanent_failure(
                    context, value, failure
                )
                failure.finalized = True
            raise failure from exc
        except asyncio.CancelledError:
            if began and context.cancellation_event.is_set():
                with suppress(JobOrchestrationError):
                    await self.repository.release_after_cancellation(context, value)
            raise
        except ProcessingJobFailure as exc:
            terminal = (
                not exc.retryable or context.attempt_number >= context.maximum_attempts
            )
            if began and terminal and not exc.finalized:
                await self.repository.finalize_permanent_failure(context, value, exc)
                exc.finalized = True
            raise
        except JobOrchestrationError:
            raise
        except Exception as exc:
            failure = ProcessingJobFailure(
                "renderer_failed",
                "The existing Capinsta export pipeline failed",
                retryable=False,
            )
            if began:
                await self.repository.finalize_permanent_failure(
                    context, value, failure
                )
                failure.finalized = True
            raise failure from exc


__all__ = [
    "ClippingExportJobHandler",
    "export_object_path",
    "verify_output",
]
