from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

import aiosqlite
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext, JobExecutionResult
from server.clipping_jobs.policies import DEFAULT_JOB_POLICIES
from server.clipping_persistence.database import DurableDatabase
from server.operational_mirror import mirror_export_job
from server.settings import DB_PATH, EXPORT_DIR

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover - installed in production
    Jsonb = None


logger = logging.getLogger(__name__)
EDITOR_EXPORT_ENGINE_VERSION = "remotion-hybrid-v1"
SUPPORTED_ENGINES = frozenset({"remotion_hybrid", "legacy"})


def configured_export_engine() -> str:
    engine = os.getenv("CAPINSTA_EXPORT_ENGINE", "remotion_hybrid").strip().lower()
    if engine not in SUPPORTED_ENGINES:
        raise RuntimeError(f"Unsupported CAPINSTA_EXPORT_ENGINE: {engine}")
    return engine


def _build_sha() -> str:
    return os.getenv("BUILD_SHA", os.getenv("CAPINSTA_IMAGE_TAG", "unknown"))


class EditorExportJobInputV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal[1] = 1
    jobType: Literal["editor_export"] = "editor_export"
    exportJobId: UUID
    ownerUserId: UUID
    engine: Literal["remotion_hybrid", "legacy"]
    engineVersion: Literal[EDITOR_EXPORT_ENGINE_VERSION] = EDITOR_EXPORT_ENGINE_VERSION
    buildSha: str = Field(min_length=1, max_length=200)
    snapshot: dict[str, Any]


async def enqueue_editor_export(
    *,
    database: DurableDatabase,
    export_job_id: str,
    owner_user_id: str,
    request: Any,
) -> EditorExportJobInputV1:
    value = EditorExportJobInputV1(
        exportJobId=export_job_id,
        ownerUserId=owner_user_id,
        engine=configured_export_engine(),
        buildSha=_build_sha(),
        snapshot=asdict(request),
    )
    policy = DEFAULT_JOB_POLICIES["editor_export"]
    payload = value.model_dump(mode="json")
    encoded = Jsonb(payload) if Jsonb is not None else payload
    async with database.transaction() as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                INSERT INTO processing_jobs (
                  id,owner_user_id,job_type,status,priority,input,max_attempts,
                  idempotency_key,execution_timeout_seconds,current_stage
                ) VALUES (%s,%s,'editor_export','queued',%s,%s,%s,%s,%s,'queued')
                ON CONFLICT (id) DO NOTHING
                RETURNING id
                """,
                (
                    UUID(export_job_id),
                    UUID(owner_user_id),
                    policy.priority,
                    encoded,
                    policy.maximum_attempts,
                    export_job_id,
                    policy.default_timeout_seconds,
                ),
            )
            row = await cursor.fetchone()
            if row is None:
                await cursor.execute(
                    "SELECT owner_user_id,job_type FROM processing_jobs WHERE id=%s",
                    (UUID(export_job_id),),
                )
                existing = await cursor.fetchone()
                if not existing or str(existing["owner_user_id"]) != owner_user_id or existing["job_type"] != "editor_export":
                    raise RuntimeError("Durable editor export job identity conflict")
    return value


async def cancel_editor_exports(
    *, database: DurableDatabase, export_job_ids: list[str], owner_user_id: str
) -> None:
    if not export_job_ids:
        return
    ids = [UUID(value) for value in export_job_ids]
    async with database.transaction() as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                UPDATE processing_jobs SET
                  status=CASE WHEN status IN ('queued','retry_wait') THEN 'cancelled' ELSE 'cancel_requested' END,
                  cancel_reason='user_requested',cancel_requested_at=COALESCE(cancel_requested_at,now()),
                  cancelled_at=CASE WHEN status IN ('queued','retry_wait') THEN now() ELSE cancelled_at END,
                  finished_at=CASE WHEN status IN ('queued','retry_wait') THEN now() ELSE finished_at END,
                  current_stage='cancelled',revision=revision+1,updated_at=now()
                WHERE id=ANY(%s::uuid[]) AND owner_user_id=%s AND job_type='editor_export'
                  AND status IN ('queued','retry_wait','claimed','running')
                """,
                (ids, UUID(owner_user_id)),
            )


async def _load_export_job(export_job_id: str) -> dict[str, Any]:
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM export_jobs WHERE id=?", (export_job_id,))
        row = await cursor.fetchone()
    if row is None:
        raise ProcessingJobFailure(
            "EXPORT_SNAPSHOT_INVALID", "The export snapshot no longer exists", retryable=False
        )
    return dict(row)


async def _update_export_job(export_job_id: str, **updates: Any) -> None:
    if not updates:
        return
    assignments = ",".join(f"{key}=?" for key in updates)
    values = [*updates.values(), export_job_id]
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute("SELECT status FROM export_jobs WHERE id=?", (export_job_id,))
        row = await cursor.fetchone()
        if row is None or (row[0] == "cancelled" and updates.get("status") != "cancelled"):
            return
        await db.execute(
            f"UPDATE export_jobs SET {assignments},updated_at=strftime('%Y-%m-%dT%H:%M:%f+00:00','now') WHERE id=?",
            values,
        )
        await db.commit()
    await mirror_export_job(export_job_id)


def _caption_document(snapshot: dict[str, Any], duration: float) -> dict[str, Any] | None:
    chunks = json.loads(snapshot.get("captions_json") or "[]")
    if not chunks:
        return None
    words: dict[str, dict[str, Any]] = {}
    clips: list[dict[str, Any]] = []
    for index, raw in enumerate(chunks):
        clip = dict(raw)
        clip_words = clip.pop("words", [])
        word_ids: list[str] = []
        for word_index, raw_word in enumerate(clip_words):
            word = dict(raw_word)
            word_id = str(word.get("id") or f"word-{index}-{word_index}")
            word.update(
                id=word_id,
                text=str(word.get("text") or word.get("displayedText") or ""),
                displayedText=str(word.get("displayedText") or word.get("text") or ""),
            )
            words[word_id] = word
            word_ids.append(word_id)
        clip.update(
            id=str(clip.get("id") or f"caption-{index}"),
            trackId=str(clip.get("trackId") or "caption-track"),
            wordIds=word_ids or list(clip.get("wordIds") or []),
            stylePresetId=str(clip.get("stylePresetId") or snapshot.get("theme") or "word_highlight_box"),
        )
        clips.append(clip)
    style = chunks[0].get("style") if isinstance(chunks[0], dict) else None
    if not style and snapshot.get("style_config_json"):
        style = json.loads(snapshot["style_config_json"])
    preset = str(snapshot.get("theme") or "word_highlight_box")
    return {
        "id": f"export-{snapshot['source_job_id']}",
        "trackId": "caption-track",
        "sourceTranscriptRef": {
            "version": "capinsta.transcript.v1",
            "sourceAssetId": "source",
            "sourceAssetName": "Export source",
            "provider": "export_snapshot",
        },
        "durationSeconds": duration,
        "languageMode": "auto",
        "stylePresetId": preset,
        "style": style,
        "clips": clips,
        "words": list(words.values()),
        "manualEdits": {},
        "timing": {
            "sourceOfTruth": "words",
            "generatedAt": "1970-01-01T00:00:00.000Z",
            "audioDurationSeconds": duration,
        },
    }


def _remotion_props(snapshot: dict[str, Any]) -> dict[str, Any]:
    composition = snapshot.get("composition_json")
    if composition:
        parsed = json.loads(composition)
        if isinstance(parsed, dict) and parsed.get("version") == 1:
            return parsed
    duration = float(snapshot.get("duration_override") or 0)
    duration_ms = round(duration * 1000)
    source = {
        "id": "source",
        "url": "/source.mp4",
        "hasAudio": bool(snapshot.get("include_audio")),
        "accessMode": "localized",
    }
    props: dict[str, Any] = {
        "version": 1,
        "export": {
            "width": int(snapshot["export_width"]),
            "height": int(snapshot["export_height"]),
            "fps": int(snapshot["export_fps"]),
            "quality": snapshot.get("quality") or "standard",
            "backgroundColor": snapshot.get("background_color") or "#101010",
        },
        "media": {"sources": [source]},
        "timeline": {
            "edl": {
                "schemaVersion": 1,
                "clipProjectId": str(snapshot["source_job_id"]),
                "projectRevision": 1,
                "sourceMediaId": "source",
                "sourceDurationMs": duration_ms,
                "outputDurationMs": duration_ms,
                "entries": [
                    {
                        "id": "export-entry-0",
                        "rangeId": "export-range-0",
                        "order": 0,
                        "sourceMediaId": "source",
                        "sourceStartMs": 0,
                        "sourceEndMs": duration_ms,
                        "sourceDurationMs": duration_ms,
                        "outputStartMs": 0,
                        "outputEndMs": duration_ms,
                        "outputDurationMs": duration_ms,
                        "playbackRate": 1,
                        "transitionIn": None,
                        "transitionOut": None,
                        "metadata": {},
                    }
                ],
                "warnings": [],
                "metadata": {},
            }
        },
    }
    captions = _caption_document(snapshot, duration)
    if captions:
        props["captions"] = {"document": captions}
    return props


class EditorExportJobHandler:
    job_type = "editor_export"

    @staticmethod
    def _input(payload: dict[str, Any]) -> EditorExportJobInputV1:
        try:
            return EditorExportJobInputV1.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError(
                "invalid_handler_input", "Editor export job input is invalid"
            ) from exc

    def validate_input(self, payload: dict[str, Any]) -> None:
        value = self._input(payload)
        worker_sha = _build_sha()
        if value.buildSha != "unknown" and worker_sha != "unknown" and value.buildSha != worker_sha:
            raise JobOrchestrationError(
                "invalid_handler_input", "Editor export API and worker build SHAs differ"
            )

    @staticmethod
    def validate_output(payload: dict[str, Any]) -> None:
        if set(payload) != {"exportJobId", "engine", "outputBytes", "remotionInvoked"}:
            raise JobOrchestrationError(
                "invalid_handler_output", "Editor export output is invalid"
            )

    async def _legacy(self, value: EditorExportJobInputV1) -> JobExecutionResult:
        from server.api import export_jobs

        job = await export_jobs._load_job_from_db(
            str(value.exportJobId), str(value.ownerUserId)
        )
        if job is None:
            raise ProcessingJobFailure(
                "EXPORT_SNAPSHOT_INVALID", "The export snapshot no longer exists", retryable=False
            )
        async with export_jobs._jobs_lock:
            export_jobs._jobs[str(value.exportJobId)] = job
        request = export_jobs.ExportRequest(**value.snapshot)
        await export_jobs._run_export_job(str(value.exportJobId), request)
        final = await _load_export_job(str(value.exportJobId))
        if final["status"] != "completed":
            raise ProcessingJobFailure(
                "EXPORT_LEGACY_FAILED",
                str(final.get("message") or "Legacy export failed"),
                retryable=False,
            )
        return JobExecutionResult(
            {"exportJobId": str(value.exportJobId), "engine": "legacy", "outputBytes": int(final["bytes"] or 0), "remotionInvoked": True}
        )

    async def execute(self, context: JobExecutionContext, payload: dict[str, Any]):
        value = self._input(payload)
        if value.engine == "legacy":
            return await self._legacy(value)

        export_id = str(value.exportJobId)
        root = Path(os.getenv("CAPINSTA_REMOTION_TEMP_ROOT", "/tmp/capinsta-remotion-export")).resolve()
        workspace = (root / export_id / f"attempt-{context.attempt_number}").resolve()
        if root not in workspace.parents:
            raise ProcessingJobFailure("EXPORT_SNAPSHOT_INVALID", "Invalid export workspace", retryable=False)
        row = await _load_export_job(export_id)
        props = _remotion_props(value.snapshot)
        source_path = str(value.snapshot.get("original_video_path") or "")
        source_map = {
            source["id"]: source_path
            for source in props["media"]["sources"]
            if source_path
        }
        output_name = f"capinsta_{value.snapshot['export_width']}x{value.snapshot['export_height']}.mp4"
        temporary_output = workspace / output_name
        props_path = workspace / "props.json"
        sources_path = workspace / "sources.json"
        process: asyncio.subprocess.Process | None = None
        try:
            minimum_free = int(os.getenv("CAPINSTA_REMOTION_MIN_FREE_BYTES", str(512 * 1024 * 1024)))
            root.mkdir(parents=True, exist_ok=True)
            if shutil.disk_usage(root).free < minimum_free:
                raise ProcessingJobFailure(
                    "EXPORT_TEMP_STORAGE_LOW", "Temporary export storage is full", retryable=True
                )
            needs_source = value.snapshot.get("export_mode") == "full_video" or bool(value.snapshot.get("include_audio"))
            if needs_source and (not source_path or not Path(source_path).is_file()):
                raise ProcessingJobFailure(
                    "EXPORT_SOURCE_UNAVAILABLE", "The export source is unavailable", retryable=False
                )
            workspace.mkdir(parents=True, exist_ok=False)
            props_path.write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")
            sources_path.write_text(json.dumps(source_map), encoding="utf-8")
            await context.heartbeat(progress=5, current_stage="preparing")
            await _update_export_job(export_id, status="running", stage="preparing", progress=5, message="Preparing export snapshot...")
            command = os.getenv("CAPINSTA_REMOTION_COMMAND", "node")
            runtime = os.getenv("CAPINSTA_REMOTION_RUNTIME", "/app/apps/remotion-exporter/.cache/hybrid-run.mjs")
            base = "solidColor" if value.snapshot.get("export_mode") in {"captions_only", "captions_only_solid_background", "captions_solid_background"} else "video"
            args = [
                command, runtime, "--props", str(props_path), "--sources", str(sources_path),
                "--output", str(temporary_output), "--base", base,
                "--color", str(value.snapshot.get("background_color") or "#101010"),
                "--transport", "png", "--concurrency", "2", "--preset", "veryfast",
                "--threads", "2", "--seekInputs",
            ]
            logger.info(
                "editor_export_started exportJobId=%s ownerId=%s workerId=%s buildSHA=%s exportEngineVersion=%s",
                export_id, value.ownerUserId, context.worker_id, _build_sha(), EDITOR_EXPORT_ENGINE_VERSION,
            )
            process = await asyncio.create_subprocess_exec(
                *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            stderr_chunks: list[str] = []

            async def read_stderr() -> None:
                assert process and process.stderr
                while chunk := await process.stderr.read(4096):
                    stderr_chunks.append(chunk.decode(errors="replace"))
                    if sum(map(len, stderr_chunks)) > 16000:
                        stderr_chunks[:] = ["".join(stderr_chunks)[-16000:]]

            async def read_stdout() -> dict[str, Any] | None:
                assert process and process.stdout
                result = None
                while line := await process.stdout.readline():
                    try:
                        event = json.loads(line)
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        continue
                    name = event.get("event")
                    if name == "hybrid_progress":
                        progress = max(6, min(96, int(event.get("progress") or 0)))
                        stage = str(event.get("stage") or "encoding")
                        await context.heartbeat(progress=progress, current_stage=stage)
                        await _update_export_job(export_id, status="running", stage=stage, progress=progress, message=str(event.get("message") or stage))
                    elif name == "hybrid_export_complete":
                        result = event
                return result

            stderr_task = asyncio.create_task(read_stderr())
            stdout_task = asyncio.create_task(read_stdout())
            wait_task = asyncio.create_task(process.wait())
            stop_task = asyncio.create_task(context.shutdown_event.wait())
            done, _ = await asyncio.wait({wait_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)
            if stop_task in done and context.shutdown_event.is_set():
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 10)
                except TimeoutError:
                    process.kill()
                    await process.wait()
                await _update_export_job(export_id, status="cancelled", stage="cancelled", progress=-1, message="Export cancelled.", error="EXPORT_CANCELLED")
                raise asyncio.CancelledError
            stop_task.cancel()
            code = await wait_task
            result = await stdout_task
            await stderr_task
            if code != 0 or result is None:
                detail = "".join(stderr_chunks)[-2000:]
                failure_code = "EXPORT_REMOTION_FAILED"
                for line in detail.splitlines():
                    try:
                        error_event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if error_event.get("event") == "hybrid_export_error" and error_event.get("code") in {
                        "EXPORT_REMOTION_FAILED", "EXPORT_FFMPEG_FAILED", "EXPORT_OUTPUT_INVALID"
                    }:
                        failure_code = error_event["code"]
                raise ProcessingJobFailure(
                    failure_code,
                    {
                        "EXPORT_FFMPEG_FAILED": "The video encoder failed",
                        "EXPORT_OUTPUT_INVALID": "The rendered MP4 failed verification",
                    }.get(failure_code, "The Remotion hybrid export failed"),
                    retryable=False,
                    details={"stderr": detail},
                )
            verification = result.get("verification") or {}
            output_bytes = int(verification.get("bytes") or 0)
            if output_bytes < 1024 or not temporary_output.is_file():
                raise ProcessingJobFailure("EXPORT_OUTPUT_INVALID", "The rendered MP4 is invalid", retryable=False)
            await context.heartbeat(progress=97, current_stage="finalizing")
            await _update_export_job(export_id, status="running", stage="finalizing", progress=97, message="Finalizing verified MP4...")
            from server.api.export_jobs import _scoped_export_path

            destination = _scoped_export_path(str(value.ownerUserId), str(row.get("project_id") or value.snapshot["source_job_id"]), export_id, output_name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(temporary_output, destination)
            await _update_export_job(
                export_id,
                status="completed", stage="completed", progress=100,
                message="MP4 export is ready to download.", error=None,
                download_url=f"/api/export/jobs/{export_id}/download", filename=output_name,
                output_path=str(destination), bytes=output_bytes,
                duration=float(verification.get("durationSeconds") or value.snapshot.get("duration_override") or 0),
                width=int(verification.get("width") or value.snapshot["export_width"]),
                height=int(verification.get("height") or value.snapshot["export_height"]),
                fps=int(round(float(verification.get("fps") or value.snapshot["export_fps"]))),
                performance_json=json.dumps({
                    "engine": value.engine,
                    "engineVersion": value.engineVersion,
                    "remotionInvoked": bool(result.get("remotionInvoked")),
                    "timings": result.get("timings"),
                    "resources": result.get("resources"),
                    "verification": verification,
                }),
            )
            logger.info(
                "editor_export_ready exportJobId=%s workerId=%s buildSHA=%s outputBytes=%s remotionInvoked=%s",
                export_id, context.worker_id, _build_sha(), output_bytes, result.get("remotionInvoked"),
            )
            return JobExecutionResult({
                "exportJobId": export_id,
                "engine": value.engine,
                "outputBytes": output_bytes,
                "remotionInvoked": bool(result.get("remotionInvoked")),
            })
        except asyncio.CancelledError:
            if process and process.returncode is None:
                process.terminate()
            await _update_export_job(export_id, status="cancelled", stage="cancelled", progress=-1, message="Export cancelled.", error="EXPORT_CANCELLED")
            raise
        except ProcessingJobFailure as exc:
            await _update_export_job(export_id, status="failed", stage="failed", progress=-1, message=exc.safe_message, error=exc.code)
            raise
        except Exception as exc:
            logger.exception("editor_export_failed exportJobId=%s workerId=%s", export_id, context.worker_id)
            await _update_export_job(export_id, status="failed", stage="failed", progress=-1, message="The export worker failed.", error="EXPORT_REMOTION_FAILED")
            raise ProcessingJobFailure("EXPORT_REMOTION_FAILED", "The export worker failed", retryable=False) from exc
        finally:
            if workspace.exists() and root in workspace.parents:
                shutil.rmtree(workspace, ignore_errors=True)
            if workspace.parent.exists() and workspace.parent.parent == root:
                try:
                    workspace.parent.rmdir()
                except OSError:
                    pass


async def register_editor_exports_if_enabled(registry: Any) -> str | None:
    enabled = os.getenv("ENABLE_EDITOR_EXPORT_HANDLER", "false").strip().lower() in {"1", "true", "yes", "on"}
    if not enabled:
        return None
    engine = configured_export_engine()
    if engine == "remotion_hybrid":
        runtime = Path(os.getenv("CAPINSTA_REMOTION_RUNTIME", "/app/apps/remotion-exporter/.cache/hybrid-run.mjs"))
        if not runtime.is_file():
            raise JobOrchestrationError("worker_not_configured", "Packaged Remotion hybrid runtime is missing")
    temp_root = Path(os.getenv("CAPINSTA_REMOTION_TEMP_ROOT", "/tmp/capinsta-remotion-export")).resolve()
    temp_root.mkdir(parents=True, exist_ok=True)
    stale_before = time.time() - int(os.getenv("CAPINSTA_REMOTION_STALE_SECONDS", "86400"))
    for candidate in temp_root.iterdir():
        resolved = candidate.resolve()
        if (
            candidate.is_dir()
            and temp_root in resolved.parents
            and len(candidate.name) == 36
            and candidate.stat().st_mtime < stale_before
        ):
            try:
                UUID(candidate.name)
            except ValueError:
                continue
            shutil.rmtree(resolved, ignore_errors=True)
    registry.register(EditorExportJobHandler())
    return f"{engine}:{EDITOR_EXPORT_ENGINE_VERSION}"
