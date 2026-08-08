import asyncio
import json
import shutil
import subprocess
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_storage.errors import StorageError
from server.clipping_storage.local_storage import LocalMediaStorage
from server.clipping_storage.models import ProbeSource
from server.media_probe.config import MediaProbeConfig
from server.media_probe.ffprobe import FFprobeRunner
from server.media_variants.config import MediaVariantConfig
from server.media_variants.contracts import (
    AudioExtractionJobInputV1,
    ProxyGenerationJobInputV1,
    ThumbnailGenerationJobInputV1,
    WaveformArtifactV1,
    WaveformGenerationJobInputV1,
)
from server.media_variants.ffmpeg import (
    FFmpegCancelled,
    FFmpegRunner,
    parse_progress_time_us,
)
from server.media_variants.handlers import (
    AudioExtractionJobHandler,
    ProxyGenerationJobHandler,
    ThumbnailGenerationJobHandler,
    WaveformGenerationJobHandler,
)
from server.media_variants.paths import variant_object_path
from server.media_variants.planning import MediaVariantPlanningService
from server.media_variants.presets import (
    PROXY_SPEC,
    generation_spec_hash,
    preset_spec,
)
from server.media_variants.verification import (
    probe_output,
    verify_audio,
    verify_proxy,
    verify_thumbnail,
    verify_waveform,
)
from server.media_variants.waveform import (
    compute_peak_pairs,
    write_waveform_artifact,
)
from server.media_variants.workspace import temporary_workspace
from server.media_variants.registration import (
    register_media_variants_if_enabled,
)
from server.media_variants.repository import MediaVariantRepository
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_persistence.database import DurableDatabase


def _run(coro):
    return asyncio.run(coro)


def _config(tmp_path: Path, **changes) -> MediaVariantConfig:
    value = MediaVariantConfig(
        enabled=True,
        ffmpeg_binary=shutil.which("ffmpeg") or "ffmpeg",
        ffprobe_binary=shutil.which("ffprobe") or "ffprobe",
        temp_root=tmp_path / "work",
        maximum_temp_bytes=100 * 1024 * 1024,
        proxy_timeout_seconds=30,
        audio_timeout_seconds=30,
        thumbnail_timeout_seconds=30,
        waveform_timeout_seconds=30,
        signed_url_ttl_seconds=60,
        signed_url_safety_seconds=2,
        storage_backend="local",
        local_storage_root=str(tmp_path / "storage"),
    )
    return replace(value, **changes)


def _job_payload(job_type: str, preset: str):
    return {
        "schemaVersion": 1,
        "jobType": job_type,
        "mediaAssetId": str(uuid4()),
        "expectedMediaRevision": 2,
        "storageObjectRevision": 1,
        "variantId": str(uuid4()),
        "generationSpecHash": generation_spec_hash(preset_spec(preset)),
        "preset": preset,
        "metadata": {},
    }


def test_generation_spec_hash_is_canonical_and_changes_with_spec():
    reordered = dict(reversed(list(PROXY_SPEC.items())))
    assert generation_spec_hash(reordered) == generation_spec_hash(PROXY_SPEC)
    changed = {**PROXY_SPEC, "maximumWidth": 640}
    assert generation_spec_hash(changed) != generation_spec_hash(PROXY_SPEC)


def test_typed_inputs_reject_sources_arbitrary_ffmpeg_and_bad_hash():
    ProxyGenerationJobInputV1.model_validate(
        _job_payload("proxy_generation", "editing-720p-v1")
    )
    AudioExtractionJobInputV1.model_validate(
        _job_payload(
            "audio_extraction", "transcription-wav-16k-mono-v1"
        )
    )
    ThumbnailGenerationJobInputV1.model_validate(
        _job_payload("thumbnail_generation", "poster-jpeg-v1")
    )
    WaveformGenerationJobInputV1.model_validate(
        _job_payload("waveform_generation", "waveform-peaks-v1")
    )
    with pytest.raises(Exception):
        ProxyGenerationJobInputV1.model_validate(
            {
                **_job_payload("proxy_generation", "editing-720p-v1"),
                "signedUrl": "https://private.example/x",
            }
        )
    with pytest.raises(Exception):
        ProxyGenerationJobInputV1.model_validate(
            {
                **_job_payload("proxy_generation", "editing-720p-v1"),
                "generationSpecHash": "bad",
            }
        )
    with pytest.raises(Exception):
        ProxyGenerationJobInputV1.model_validate(
            {
                **_job_payload("proxy_generation", "editing-720p-v1"),
                "metadata": {"ffmpegArguments": ["-vf", "evil"]},
            }
        )


def test_planning_matrix_omits_unsupported_variants():
    video_audio = {"mediaKind": "video", "video": {}, "audio": {}}
    assert MediaVariantPlanningService.required_job_types(video_audio) == (
        "proxy_generation",
        "thumbnail_generation",
        "audio_extraction",
        "waveform_generation",
    )
    assert MediaVariantPlanningService.required_job_types(
        {"mediaKind": "video", "video": {}, "audio": None}
    ) == ("proxy_generation", "thumbnail_generation")
    assert MediaVariantPlanningService.required_job_types(
        {"mediaKind": "audio", "video": None, "audio": {}}
    ) == ("audio_extraction", "waveform_generation")


def test_repository_rejects_missing_stale_and_unauthorized_targets():
    owner, media_id, variant_id = uuid4(), uuid4(), uuid4()
    payload = _job_payload("proxy_generation", "editing-720p-v1")
    payload["mediaAssetId"] = str(media_id)
    payload["variantId"] = str(variant_id)
    job_input = ProxyGenerationJobInputV1.model_validate(payload)
    job = {
        "owner_user_id": owner,
        "media_asset_id": media_id,
        "job_type": "proxy_generation",
    }
    asset = {
        "id": media_id,
        "owner_user_id": owner,
        "deleted_at": None,
        "status": "ready",
        "revision": 2,
        "storage_object_revision": 1,
        "storage_bucket": "source-media",
        "storage_path": f"{owner}/{media_id}/source/v1.mp4",
    }
    variant = {
        "id": variant_id,
        "media_asset_id": media_id,
        "variant_type": "proxy",
        "source_media_revision": 2,
        "source_storage_object_revision": 1,
        "generation_spec_hash": payload["generationSpecHash"],
        "deleted_at": None,
        "status": "queued",
    }
    MediaVariantRepository._validate(job, asset, variant, job_input)
    for changed, expected in (
        ({"asset": None}, "media_asset_not_found"),
        ({"variant": None}, "variant_not_found"),
        ({"asset": {**asset, "status": "probing"}}, "source_media_not_ready"),
        (
            {"asset": {**asset, "revision": 3}},
            "variant_source_revision_mismatch",
        ),
        (
            {"asset": {**asset, "storage_object_revision": 2}},
            "variant_storage_revision_mismatch",
        ),
        (
            {"job": {**job, "owner_user_id": uuid4()}},
            "variant_not_found",
        ),
    ):
        with pytest.raises(ProcessingJobFailure) as error:
            MediaVariantRepository._validate(
                changed.get("job", job),
                changed.get("asset", asset),
                changed.get("variant", variant),
                job_input,
            )
        assert error.value.code == expected


def test_handlers_reject_missing_required_streams():
    proxy = object.__new__(ProxyGenerationJobHandler)
    audio = object.__new__(AudioExtractionJobHandler)
    thumbnail = object.__new__(ThumbnailGenerationJobHandler)
    waveform = object.__new__(WaveformGenerationJobHandler)
    with pytest.raises(ProcessingJobFailure) as error:
        proxy._validate_streams({"probe_output": {"video": None}})
    assert error.value.code == "proxy_unsupported_for_audio"
    with pytest.raises(ProcessingJobFailure) as error:
        audio._validate_streams({"probe_output": {"audio": None}})
    assert error.value.code == "audio_stream_missing"
    with pytest.raises(ProcessingJobFailure) as error:
        thumbnail._validate_streams({"probe_output": {"video": None}})
    assert error.value.code == "thumbnail_unsupported_for_audio"
    with pytest.raises(ProcessingJobFailure) as error:
        waveform._validate_streams({"probe_output": {"audio": None}})
    assert error.value.code == "audio_stream_missing"


def test_variant_paths_are_revisioned_and_private():
    owner, asset = uuid4(), uuid4()
    digest = generation_spec_hash(PROXY_SPEC)
    path = variant_object_path(
        owner_user_id=owner,
        media_asset_id=asset,
        variant_type="proxy",
        source_revision=2,
        spec_hash=digest,
    )
    assert path == (
        f"{owner}/{asset}/variants/proxy/r2/{digest[:12]}/proxy.mp4"
    )
    assert "@" not in path
    with pytest.raises(StorageError):
        variant_object_path(
            owner_user_id=owner,
            media_asset_id=asset,
            variant_type="../../escape",
            source_revision=2,
            spec_hash=digest,
        )


def test_waveform_peak_pairs_are_deterministic_and_bounded(tmp_path):
    import array

    samples = array.array("h", [-100, 50, -20, 200, 0])
    pcm = tmp_path / "samples.pcm"
    pcm.write_bytes(samples.tobytes())
    with pcm.open("rb") as stream:
        assert compute_peak_pairs(
            stream, samples_per_bucket=2, maximum_peaks=3
        ) == [(-100, 50), (-20, 200), (0, 0)]
    with pcm.open("rb") as stream:
        with pytest.raises(ProcessingJobFailure) as error:
            compute_peak_pairs(
                stream, samples_per_bucket=1, maximum_peaks=2
            )
    assert error.value.code == "waveform_invalid"


def test_progress_parser_ignores_malformed_values():
    assert parse_progress_time_us({"out_time_us": "1234"}) == 1234
    assert parse_progress_time_us({"out_time_ms": "5000"}) == 5000
    assert parse_progress_time_us({"out_time_us": "-1"}) is None
    assert parse_progress_time_us({"out_time_us": "bad"}) is None


@pytest.mark.parametrize("outcome", ["cancel", "lease", "timeout"])
def test_ffmpeg_runner_terminates_on_control_signals(
    tmp_path, monkeypatch, outcome
):
    class FakeProcess:
        def __init__(self):
            self.stdout = asyncio.StreamReader()
            self.stderr = asyncio.StreamReader()
            self.returncode = None
            self.pid = None
            self.terminated = False
            self._done = asyncio.Event()

        async def wait(self):
            await self._done.wait()
            return self.returncode

        def terminate(self):
            self.terminated = True
            self.returncode = -15
            self.stdout.feed_eof()
            self.stderr.feed_eof()
            self._done.set()

        def kill(self):
            self.terminate()

    processes = []

    async def create_process(*args, **kwargs):
        del args, kwargs
        process = FakeProcess()
        processes.append(process)
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    runner = FFmpegRunner(_config(tmp_path))
    cancelled = asyncio.Event()
    lease_lost = asyncio.Event()
    if outcome == "cancel":
        cancelled.set()
    elif outcome == "lease":
        lease_lost.set()

    async def never():
        return False

    async def exercise():
        return await runner.run(
            ProbeSource(
                kind="local_path",
                value=str(tmp_path / "source.mp4"),
                expires_at=None,
                redacted_display="[source]",
            ),
            arguments=("-f", "null", str(tmp_path / "output")),
            duration_ms=1000,
            timeout_seconds=0.01 if outcome == "timeout" else 10,
            job_timeout_seconds=10,
            cancellation_check=never,
            cancellation_event=cancelled,
            lease_lost_event=lease_lost,
            stop_event=asyncio.Event(),
            progress_callback=lambda value: asyncio.sleep(0),
        )

    expected = {
        "cancel": FFmpegCancelled,
        "lease": JobOrchestrationError,
        "timeout": ProcessingJobFailure,
    }[outcome]
    with pytest.raises(expected):
        _run(exercise())
    assert processes[0].terminated


@pytest.mark.parametrize(
    ("raised", "code", "retryable"),
    [
        (FileNotFoundError(), "ffmpeg_not_installed", False),
        (PermissionError(), "ffmpeg_start_failed", True),
    ],
)
def test_ffmpeg_runner_normalizes_start_failures(
    tmp_path, monkeypatch, raised, code, retryable
):
    async def create_process(*args, **kwargs):
        del args, kwargs
        raise raised

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)

    async def never():
        return False

    with pytest.raises(ProcessingJobFailure) as error:
        _run(
            FFmpegRunner(_config(tmp_path)).run(
                ProbeSource(
                    "local_path",
                    str(tmp_path / "source.mp4"),
                    None,
                    "[source]",
                ),
                arguments=("-f", "null", str(tmp_path / "output")),
                duration_ms=1000,
                timeout_seconds=10,
                job_timeout_seconds=10,
                cancellation_check=never,
                cancellation_event=asyncio.Event(),
                lease_lost_event=asyncio.Event(),
                stop_event=asyncio.Event(),
                progress_callback=lambda value: asyncio.sleep(0),
            )
        )
    assert error.value.code == code
    assert error.value.retryable is retryable


def test_local_variant_upload_reuses_identical_and_rejects_conflict(tmp_path):
    storage = LocalMediaStorage(tmp_path / "storage")
    owner, asset = uuid4(), uuid4()
    digest = generation_spec_hash(PROXY_SPEC)
    path = variant_object_path(
        owner_user_id=owner,
        media_asset_id=asset,
        variant_type="proxy",
        source_revision=1,
        spec_hash=digest,
    )
    source = tmp_path / "proxy.mp4"
    source.write_bytes(b"synthetic-proxy")
    import hashlib

    checksum = hashlib.sha256(source.read_bytes()).hexdigest()
    first = _run(
        storage.upload_file(
            bucket="media-variants",
            path=path,
            local_path=source,
            content_type="video/mp4",
            maximum_bytes=1000,
            checksum=checksum,
        )
    )
    replay = _run(
        storage.upload_file(
            bucket="media-variants",
            path=path,
            local_path=source,
            content_type="video/mp4",
            maximum_bytes=1000,
            checksum=checksum,
        )
    )
    assert replay.checksum == first.checksum == checksum
    source.write_bytes(b"different")
    with pytest.raises(StorageError) as error:
        _run(
            storage.upload_file(
                bucket="media-variants",
                path=path,
                local_path=source,
                content_type="video/mp4",
                maximum_bytes=1000,
                checksum=hashlib.sha256(source.read_bytes()).hexdigest(),
            )
        )
    assert error.value.category == "object_already_exists"
    with pytest.raises(StorageError):
        _run(
            storage.upload_file(
                bucket="source-media",
                path=f"{owner}/{asset}/source/v1.mp4",
                local_path=source,
                content_type="video/mp4",
                maximum_bytes=1000,
                checksum="0" * 64,
            )
        )


def test_temporary_workspace_is_confined_and_cleaned(tmp_path):
    job_id = uuid4()

    async def exercise():
        async with temporary_workspace(
            tmp_path / "root",
            job_id=job_id,
            attempt_number=1,
            maximum_bytes=1,
        ) as workspace:
            (workspace / "owned.txt").write_text("x")
            assert workspace.is_dir()
            return workspace

    workspace = _run(exercise())
    assert not workspace.exists()


def test_handler_registration_is_disabled_by_default_and_selective(
    tmp_path, monkeypatch
):
    monkeypatch.delenv("ENABLE_MEDIA_VARIANT_HANDLERS", raising=False)
    registry = JobHandlerRegistry()
    assert (
        _run(
            register_media_variants_if_enabled(
                registry, DurableDatabase("postgresql://unused")
            )
        )
        is None
    )
    assert registry.supported_job_types == ()

    monkeypatch.setenv("ENABLE_MEDIA_VARIANT_HANDLERS", "true")
    monkeypatch.setenv(
        "MEDIA_VARIANT_JOB_TYPES",
        "thumbnail_generation,waveform_generation",
    )
    monkeypatch.setenv("MEDIA_VARIANT_STORAGE_BACKEND", "local")
    monkeypatch.setenv(
        "MEDIA_VARIANT_LOCAL_STORAGE_ROOT", str(tmp_path / "storage")
    )
    monkeypatch.setenv("MEDIA_VARIANT_TEMP_ROOT", str(tmp_path / "temp"))

    async def ffmpeg_available(self):
        return "ffmpeg version test"

    async def ffprobe_available(self):
        return "ffprobe version test"

    monkeypatch.setattr(FFmpegRunner, "validate_available", ffmpeg_available)
    monkeypatch.setattr(FFprobeRunner, "validate_available", ffprobe_available)
    versions = _run(
        register_media_variants_if_enabled(
            registry, DurableDatabase("postgresql://unused")
        )
    )
    assert versions == ("ffmpeg version test", "ffprobe version test")
    assert registry.supported_job_types == (
        "thumbnail_generation",
        "waveform_generation",
    )


@pytest.mark.skipif(
    not shutil.which("ffmpeg") or not shutil.which("ffprobe"),
    reason="FFmpeg and FFprobe are required for real media generation",
)
def test_real_proxy_audio_thumbnail_and_waveform_generation(tmp_path):
    source = tmp_path / "source.mp4"
    subprocess.run(
        [
            shutil.which("ffmpeg") or "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=320x180:r=24:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=1",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-shortest",
            str(source),
        ],
        check=True,
        timeout=30,
    )
    config = _config(tmp_path)
    runner = FFmpegRunner(config)
    verifier = FFprobeRunner(
        MediaProbeConfig(
            enabled=True,
            ffprobe_binary=config.ffprobe_binary,
            timeout_seconds=10,
            terminate_grace_seconds=1,
            signed_url_ttl_seconds=30,
            signed_url_safety_seconds=2,
        )
    )
    probe = {
        "video": {"streamIndex": 0},
        "audio": {"streamIndex": 1},
    }
    asset = {"probe_output": probe, "duration_ms": 1000}
    source_model = ProbeSource(
        kind="local_path",
        value=str(source),
        expires_at=None,
        redacted_display="[test-source]",
    )
    asset["source"] = source_model

    async def never():
        return False

    async def progress(value):
        assert 5 <= value <= 85

    async def generate():
        proxy = tmp_path / "proxy.mp4"
        audio = tmp_path / "audio.wav"
        poster = tmp_path / "poster.jpg"
        common = {
            "duration_ms": 1000,
            "timeout_seconds": 30,
            "job_timeout_seconds": 30,
            "cancellation_check": never,
            "cancellation_event": asyncio.Event(),
            "lease_lost_event": asyncio.Event(),
            "stop_event": asyncio.Event(),
            "progress_callback": progress,
        }
        proxy_handler = object.__new__(ProxyGenerationJobHandler)
        proxy_args = ProxyGenerationJobHandler._arguments(
            proxy_handler, None, asset, proxy
        )
        await runner.run(source_model, arguments=proxy_args, **common)
        audio_handler = object.__new__(AudioExtractionJobHandler)
        audio_args = AudioExtractionJobHandler._arguments(
            audio_handler, None, asset, audio
        )
        await runner.run(source_model, arguments=audio_args, **common)
        thumb_input = object()
        thumb_handler = object.__new__(ThumbnailGenerationJobHandler)
        thumb_args = ThumbnailGenerationJobHandler._arguments(
            thumb_handler, thumb_input, asset, poster
        )
        await runner.run(source_model, arguments=thumb_args, **common)
        return proxy, audio, poster

    proxy, audio, poster = _run(generate())
    proxy_metadata = _run(probe_output(verifier, proxy, config=config))
    audio_metadata = _run(probe_output(verifier, audio, config=config))
    poster_metadata = _run(probe_output(verifier, poster, config=config))
    assert verify_proxy(
        proxy_metadata,
        source_duration_ms=1000,
        expect_audio=True,
        tolerance_ms=1000,
    )["videoCodec"] == "h264"
    assert verify_audio(
        audio_metadata, source_duration_ms=1000, tolerance_ms=1000
    )["sampleRateHz"] == 16000
    assert verify_thumbnail(poster_metadata)["width"] == 320

    pcm = tmp_path / "waveform.pcm"
    subprocess.run(
        [
            shutil.which("ffmpeg") or "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-map",
            "0:1",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "s16le",
            str(pcm),
        ],
        check=True,
        timeout=30,
    )
    waveform = tmp_path / "waveform.json"
    artifact = write_waveform_artifact(
        pcm,
        waveform,
        media_asset_id=uuid4(),
        source_revision=2,
        duration_ms=1000,
        bucket_duration_ms=10,
        maximum_peaks=200_000,
    )
    checked = verify_waveform(
        waveform,
        source_duration_ms=1000,
        maximum_peaks=200_000,
        maximum_bytes=20 * 1024 * 1024,
    )
    assert checked == artifact
    assert all(
        isinstance(value, int)
        for pair in json.loads(waveform.read_text())["peaks"]
        for value in pair
    )
    assert len(artifact.peaks) <= 200_000


@pytest.mark.skipif(
    not shutil.which("ffmpeg") or not shutil.which("ffprobe"),
    reason="FFmpeg and FFprobe are required for real media generation",
)
def test_real_video_without_audio_and_audio_only_sources(tmp_path):
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    silent_video = tmp_path / "silent.mp4"
    audio_only = tmp_path / "audio-only.wav"
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=160x90:r=15:d=1",
            "-c:v",
            "mpeg4",
            str(silent_video),
        ],
        check=True,
        timeout=30,
    )
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:sample_rate=44100:duration=1",
            str(audio_only),
        ],
        check=True,
        timeout=30,
    )
    config = _config(tmp_path)
    runner = FFmpegRunner(config)
    verifier = FFprobeRunner(
        MediaProbeConfig(
            enabled=True,
            ffprobe_binary=config.ffprobe_binary,
            timeout_seconds=10,
            terminate_grace_seconds=1,
            signed_url_ttl_seconds=30,
            signed_url_safety_seconds=2,
        )
    )

    async def never():
        return False

    async def progress(value):
        assert 5 <= value <= 85

    async def make_variants():
        proxy = tmp_path / "silent-proxy.mp4"
        extracted = tmp_path / "audio-only-extract.wav"
        proxy_asset = {
            "probe_output": {
                "video": {"streamIndex": 0},
                "audio": None,
            },
            "duration_ms": 1000,
        }
        audio_asset = {
            "probe_output": {
                "video": None,
                "audio": {"streamIndex": 0},
            },
            "duration_ms": 1000,
        }
        proxy_args = ProxyGenerationJobHandler._arguments(
            object.__new__(ProxyGenerationJobHandler),
            None,
            proxy_asset,
            proxy,
        )
        audio_args = AudioExtractionJobHandler._arguments(
            object.__new__(AudioExtractionJobHandler),
            None,
            audio_asset,
            extracted,
        )
        common = {
            "duration_ms": 1000,
            "timeout_seconds": 30,
            "job_timeout_seconds": 30,
            "cancellation_check": never,
            "cancellation_event": asyncio.Event(),
            "lease_lost_event": asyncio.Event(),
            "stop_event": asyncio.Event(),
            "progress_callback": progress,
        }
        await runner.run(
            ProbeSource("local_path", str(silent_video), None, "[silent]"),
            arguments=proxy_args,
            **common,
        )
        await runner.run(
            ProbeSource("local_path", str(audio_only), None, "[audio]"),
            arguments=audio_args,
            **common,
        )
        return proxy, extracted

    proxy, extracted = _run(make_variants())
    assert (
        verify_proxy(
            _run(probe_output(verifier, proxy, config=config)),
            source_duration_ms=1000,
            expect_audio=False,
            tolerance_ms=1000,
        )["audioCodec"]
        is None
    )
    assert (
        verify_audio(
            _run(probe_output(verifier, extracted, config=config)),
            source_duration_ms=1000,
            tolerance_ms=1000,
        )["channels"]
        == 1
    )
