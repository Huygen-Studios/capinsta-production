import asyncio
import json
import shutil
import subprocess
import wave
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest

from server.clipping_jobs.errors import (
    JobOrchestrationError,
    ProcessingJobFailure,
)
from server.clipping_jobs.models import JobExecutionContext
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_persistence.database import DurableDatabase
from server.clipping_storage.errors import StorageError
from server.clipping_storage.models import ProbeSource, StorageObjectMetadata
from server.media_probe.config import MediaProbeConfig
from server.media_probe.contracts import (
    MediaProbeJobInputV1,
    MediaProbeResultV1,
)
from server.media_probe.ffprobe import FFprobeRunner, MediaProbeCancelled
from server.media_probe.handler import MediaProbeJobHandler
from server.media_probe.normalization import (
    MediaProbeNormalizer,
    parse_duration_ms,
    parse_ffprobe_json,
    parse_frame_rate,
    select_primary_audio,
    select_primary_video,
)
from server.media_probe.registration import register_media_probe_if_enabled


def _run(coro):
    return asyncio.run(coro)


def _config(**changes):
    base = MediaProbeConfig(
        enabled=True,
        ffprobe_binary=shutil.which("ffprobe") or "ffprobe",
        timeout_seconds=10,
        terminate_grace_seconds=1,
        signed_url_ttl_seconds=30,
        signed_url_safety_seconds=2,
        maximum_stdout_bytes=1_048_576,
        maximum_stderr_bytes=65_536,
        storage_backend="supabase",
    )
    return replace(base, **changes)


def _input(**changes):
    value = {
        "schemaVersion": 1,
        "jobType": "media_probe",
        "mediaAssetId": str(uuid4()),
        "expectedMediaRevision": 2,
        "storageObjectRevision": 1,
        "requestedFields": None,
        "metadata": {},
    }
    value.update(changes)
    return MediaProbeJobInputV1.model_validate(value)


def _video_stream(**changes):
    value = {
        "index": 0,
        "codec_type": "video",
        "codec_name": "h264",
        "codec_long_name": "H.264",
        "profile": "High",
        "width": 1920,
        "height": 1080,
        "coded_width": 1920,
        "coded_height": 1088,
        "pix_fmt": "yuv420p",
        "duration": "1.000",
        "bit_rate": "1000000",
        "avg_frame_rate": "30000/1001",
        "r_frame_rate": "30/1",
        "disposition": {"default": 1, "attached_pic": 0},
        "tags": {},
        "side_data_list": [],
    }
    value.update(changes)
    return value


def _audio_stream(**changes):
    value = {
        "index": 1,
        "codec_type": "audio",
        "codec_name": "aac",
        "sample_rate": "48000",
        "channels": 2,
        "channel_layout": "stereo",
        "duration": "1.000",
        "disposition": {"default": 1},
    }
    value.update(changes)
    return value


def _payload(*streams, duration="1.000"):
    return {
        "format": {
            "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
            "format_long_name": "QuickTime / MOV",
            "duration": duration,
            "size": "1000",
            "bit_rate": "8000",
        },
        "streams": list(streams),
    }


def _normalizer():
    return MediaProbeNormalizer(
        maximum_duration_ms=86_400_000, maximum_fps=240
    )


def test_media_probe_input_rejects_sources_options_and_versions():
    with pytest.raises(Exception):
        _input(schemaVersion=2)
    with pytest.raises(Exception):
        _input(signedUrl="https://private.example/file?token=secret")
    with pytest.raises(Exception):
        _input(metadata={"sourceUrl": "https://private.example"})
    with pytest.raises(Exception):
        _input(metadata={"note": "C:\\private\\source.mp4"})


def test_parser_accepts_valid_json_and_rejects_invalid_shapes():
    valid = json.dumps(_payload(_video_stream())).encode()
    assert parse_ffprobe_json(valid, maximum_bytes=len(valid))["streams"]
    for invalid in (
        b"{",
        b"[]",
        b'{"streams":[]}',
        b'{"format":{}}',
        b'{"format":{},"streams":[1]}',
    ):
        with pytest.raises(ProcessingJobFailure) as error:
            parse_ffprobe_json(invalid, maximum_bytes=10_000)
        assert error.value.code == "ffprobe_output_invalid"
    with pytest.raises(ProcessingJobFailure) as error:
        parse_ffprobe_json(valid, maximum_bytes=len(valid) - 1)
    assert error.value.code == "ffprobe_output_too_large"


@pytest.mark.parametrize(
    ("seconds", "milliseconds"),
    [
        ("1", 1000),
        ("1.234", 1234),
        ("1.2345", 1235),
        ("0.0005", 1),
    ],
)
def test_duration_uses_decimal_half_up(seconds, milliseconds):
    assert parse_duration_ms(seconds, maximum_ms=10_000) == milliseconds


@pytest.mark.parametrize("value", ["-1", "NaN", "Infinity", "bad"])
def test_duration_rejects_invalid_values(value):
    with pytest.raises(ProcessingJobFailure):
        parse_duration_ms(value, maximum_ms=10_000)
    with pytest.raises(ProcessingJobFailure):
        parse_duration_ms("11", maximum_ms=10_000)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("30000/1001", (30000, 1001)),
        ("25/1", (25, 1)),
        ("50/2", (25, 1)),
        ("0/0", None),
        ("N/A", None),
        ("25/0", None),
        ("1000/1", None),
    ],
)
def test_frame_rate_remains_rational(value, expected):
    assert parse_frame_rate(value, maximum_fps=240) == expected


def test_duration_fallback_rotation_and_display_dimensions():
    parsed = _payload(
        _video_stream(
            duration="2.500",
            avg_frame_rate="N/A",
            r_frame_rate="25/1",
            side_data_list=[{"rotation": -90}],
        ),
        _audio_stream(duration="2.500"),
        duration="N/A",
    )
    result = _normalizer().normalize(
        parsed,
        job_input=_input(),
        declared_mime="video/mp4",
        storage_mime="video/mp4",
        display_name="sample.mp4",
    )
    assert result.durationMs == 2500
    assert (result.video.width, result.video.height) == (1080, 1920)
    assert (result.video.encodedWidth, result.video.encodedHeight) == (
        1920,
        1080,
    )
    assert result.video.rotationDegrees == 270
    assert (result.video.fpsNumerator, result.video.fpsDenominator) == (25, 1)
    assert result.warnings == [
        "duration_stream_fallback",
        "fps_r_frame_rate_fallback",
    ]


def test_missing_duration_is_a_permanent_failure():
    parsed = _payload(_video_stream(duration=None), duration=None)
    with pytest.raises(ProcessingJobFailure) as error:
        _normalizer().normalize(
            parsed,
            job_input=_input(),
            declared_mime="video/mp4",
            storage_mime="video/mp4",
            display_name="sample.mp4",
        )
    assert error.value.code == "ffprobe_duration_unavailable"
    assert error.value.retryable is False


@pytest.mark.parametrize(
    ("rotation", "expected"),
    [("0", 0), ("90", 90), ("180", 180), ("270", 270), ("-90", 270)],
)
def test_tag_rotation_is_normalized(rotation, expected):
    result = _normalizer().normalize(
        _payload(_video_stream(tags={"rotate": rotation})),
        job_input=_input(),
        declared_mime="video/mp4",
        storage_mime="video/mp4",
        display_name="sample.mp4",
    )
    assert result.video.rotationDegrees == expected


def test_invalid_rotation_and_missing_fps_are_warnings():
    result = _normalizer().normalize(
        _payload(
            _video_stream(
                tags={"rotate": "42"},
                avg_frame_rate="0/0",
                r_frame_rate="N/A",
            )
        ),
        job_input=_input(),
        declared_mime="video/mp4",
        storage_mime="video/mp4",
        display_name="sample.mp4",
    )
    assert result.video.rotationDegrees == 0
    assert result.video.fpsNumerator is None
    assert result.warnings == ["fps_unavailable", "invalid_rotation"]


def test_primary_stream_selection_is_deterministic():
    cover = _video_stream(
        index=0,
        width=4000,
        height=4000,
        disposition={"default": 1, "attached_pic": 1},
    )
    small = _video_stream(index=3, width=640, height=360, disposition={})
    large = _video_stream(index=2, width=1280, height=720, disposition={})
    default = _video_stream(
        index=4,
        width=320,
        height=180,
        disposition={"default": 1},
    )
    assert select_primary_video([cover, small, large, default]) is default
    assert select_primary_video([cover, small, large]) is large
    mono = _audio_stream(index=4, channels=1, sample_rate="44100", disposition={})
    surround = _audio_stream(index=3, channels=6, sample_rate="48000", disposition={})
    audio_default = _audio_stream(index=5, channels=1, disposition={"default": 1})
    assert select_primary_audio([mono, surround, audio_default]) is audio_default
    assert select_primary_audio([mono, surround]) is surround


def test_audio_only_and_no_supported_streams():
    result = _normalizer().normalize(
        _payload(_audio_stream(index=0)),
        job_input=_input(),
        declared_mime="video/mp4",
        storage_mime="audio/wav",
        display_name="sample.bin",
    )
    assert result.mediaKind == "audio"
    assert result.video is None
    assert result.audio.present is True
    assert result.warnings == [
        "container_extension_mismatch",
        "declared_mime_mismatch",
    ]
    with pytest.raises(ProcessingJobFailure) as error:
        _normalizer().normalize(
            _payload({"index": 0, "codec_type": "subtitle"}),
            job_input=_input(),
            declared_mime=None,
            storage_mime=None,
            display_name="sample.bin",
        )
    assert error.value.code == "ffprobe_no_supported_streams"


def test_excessive_known_strings_are_bounded():
    result = _normalizer().normalize(
        _payload(_video_stream(codec_long_name="x" * 1000)),
        job_input=_input(),
        declared_mime="video/mp4",
        storage_mime="video/mp4",
        display_name="sample.mp4",
    )
    assert len(result.video.codecLongName) == 200
    assert "video_codec_long_truncated" in result.warnings


def _write_wav(path: Path, *, duration_seconds: float = 0.25):
    sample_rate = 8000
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b"\x00\x00" * int(sample_rate * duration_seconds))


async def _never_cancel():
    return False


def _real_run(runner, path):
    return _run(
        runner.run(
            ProbeSource(
                kind="local_path",
                value=str(path),
                expires_at=None,
                redacted_display="[local-private-object]",
            ),
            job_timeout_seconds=20,
            cancellation_check=_never_cancel,
            cancellation_event=asyncio.Event(),
            lease_lost_event=asyncio.Event(),
            stop_event=asyncio.Event(),
        )
    )


@pytest.mark.skipif(shutil.which("ffprobe") is None, reason="FFprobe unavailable")
def test_real_ffprobe_audio_and_malformed_input(tmp_path):
    wav = tmp_path / "short.wav"
    _write_wav(wav)
    runner = FFprobeRunner(_config())
    parsed = parse_ffprobe_json(
        _real_run(runner, wav), maximum_bytes=1_048_576
    )
    result = _normalizer().normalize(
        parsed,
        job_input=_input(),
        declared_mime="audio/wav",
        storage_mime="audio/wav",
        display_name=wav.name,
    )
    assert result.mediaKind == "audio"
    assert result.durationMs == 250
    assert result.audio.codecName == "pcm_s16le"
    malformed = tmp_path / "not-media.bin"
    malformed.write_bytes(b"synthetic non-media")
    with pytest.raises(ProcessingJobFailure) as error:
        _real_run(runner, malformed)
    assert error.value.code == "ffprobe_nonzero_exit"
    assert str(malformed) not in error.value.details.get("diagnostic", "")


@pytest.mark.skipif(
    shutil.which("ffprobe") is None or shutil.which("ffmpeg") is None,
    reason="FFmpeg/FFprobe unavailable",
)
def test_real_ffprobe_video_with_audio_and_video_only(tmp_path):
    ffmpeg = shutil.which("ffmpeg")
    with_audio = tmp_path / "with-audio.mp4"
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x90:rate=30000/1001",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "0.5",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(with_audio),
        ],
        check=True,
        capture_output=True,
    )
    video_only = tmp_path / "video-only.mp4"
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=128x72:rate=25",
            "-t",
            "0.4",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(video_only),
        ],
        check=True,
        capture_output=True,
    )
    runner = FFprobeRunner(_config())
    first = _normalizer().normalize(
        parse_ffprobe_json(
            _real_run(runner, with_audio), maximum_bytes=1_048_576
        ),
        job_input=_input(),
        declared_mime="video/mp4",
        storage_mime="video/mp4",
        display_name=with_audio.name,
    )
    second = _normalizer().normalize(
        parse_ffprobe_json(
            _real_run(runner, video_only), maximum_bytes=1_048_576
        ),
        job_input=_input(),
        declared_mime="video/mp4",
        storage_mime="video/mp4",
        display_name=video_only.name,
    )
    assert first.mediaKind == "video" and first.audio is not None
    assert (first.video.fpsNumerator, first.video.fpsDenominator) == (
        30000,
        1001,
    )
    assert second.mediaKind == "video" and second.audio is None
    assert (second.video.width, second.video.height) == (128, 72)


def test_runner_terminates_controlled_process_on_cancellation(monkeypatch):
    class Stream:
        def __init__(self, stopped):
            self.stopped = stopped

        async def read(self, size):
            await self.stopped.wait()
            return b""

    class Process:
        def __init__(self):
            self.stopped = asyncio.Event()
            self.stdout = Stream(self.stopped)
            self.stderr = Stream(self.stopped)
            self.returncode = None
            self.pid = None
            self.terminated = False

        async def wait(self):
            await self.stopped.wait()
            self.returncode = -15
            return self.returncode

        def terminate(self):
            self.terminated = True
            self.stopped.set()

        def kill(self):
            self.stopped.set()

    process = Process()

    async def create_process(*args, **kwargs):
        return process

    async def cancelled():
        return True

    monkeypatch.setattr(
        "server.media_probe.ffprobe.asyncio.create_subprocess_exec",
        create_process,
    )
    runner = FFprobeRunner(_config())
    with pytest.raises(MediaProbeCancelled):
        _run(
            runner.run(
                ProbeSource(
                    kind="local_path",
                    value="trusted-local-source",
                    expires_at=None,
                    redacted_display="[local-private-object]",
                ),
                job_timeout_seconds=20,
                cancellation_check=cancelled,
                cancellation_event=asyncio.Event(),
                lease_lost_event=asyncio.Event(),
                stop_event=asyncio.Event(),
            )
        )
    assert process.terminated is True
    assert process.returncode == -15


def test_runner_terminates_controlled_process_on_hard_timeout(monkeypatch):
    class Stream:
        def __init__(self, stopped):
            self.stopped = stopped

        async def read(self, size):
            await self.stopped.wait()
            return b""

    class Process:
        def __init__(self):
            self.stopped = asyncio.Event()
            self.stdout = Stream(self.stopped)
            self.stderr = Stream(self.stopped)
            self.returncode = None
            self.pid = None
            self.terminated = False

        async def wait(self):
            await self.stopped.wait()
            self.returncode = -15
            return self.returncode

        def terminate(self):
            self.terminated = True
            self.stopped.set()

        def kill(self):
            self.stopped.set()

    process = Process()

    async def create_process(*args, **kwargs):
        return process

    monkeypatch.setattr(
        "server.media_probe.ffprobe.asyncio.create_subprocess_exec",
        create_process,
    )
    runner = FFprobeRunner(_config(timeout_seconds=1))
    with pytest.raises(ProcessingJobFailure) as error:
        _real_run(runner, Path("trusted-local-source"))
    assert error.value.code == "ffprobe_timeout"
    assert error.value.retryable is True
    assert process.terminated is True


def test_runner_rejects_oversized_captured_output(monkeypatch):
    class Stream:
        def __init__(self, value):
            self.value = value

        async def read(self, size):
            value, self.value = self.value, b""
            return value

    class Process:
        def __init__(self):
            self.stdout = Stream(b"x" * 2048)
            self.stderr = Stream(b"")
            self.returncode = 0
            self.pid = None

        async def wait(self):
            return 0

    async def create_process(*args, **kwargs):
        return Process()

    monkeypatch.setattr(
        "server.media_probe.ffprobe.asyncio.create_subprocess_exec",
        create_process,
    )
    runner = FFprobeRunner(_config(maximum_stdout_bytes=1024))
    with pytest.raises(ProcessingJobFailure) as error:
        _real_run(runner, Path("trusted-source"))
    assert error.value.code == "ffprobe_output_too_large"


def test_runner_redacts_signed_url_from_nonzero_error(monkeypatch):
    signed = "https://private.example/object?token=super-secret"

    class Stream:
        def __init__(self, value):
            self.value = value

        async def read(self, size):
            value, self.value = self.value, b""
            return value

    class Process:
        def __init__(self):
            self.stdout = Stream(b"")
            self.stderr = Stream(
                f"failed to open {signed}".encode("utf-8")
            )
            self.returncode = 1
            self.pid = None

        async def wait(self):
            return 1

    async def create_process(*args, **kwargs):
        return Process()

    monkeypatch.setattr(
        "server.media_probe.ffprobe.asyncio.create_subprocess_exec",
        create_process,
    )
    runner = FFprobeRunner(_config())
    with pytest.raises(ProcessingJobFailure) as error:
        _run(
            runner.run(
                ProbeSource(
                    kind="ephemeral_url",
                    value=signed,
                    expires_at=datetime.now(timezone.utc)
                    + timedelta(seconds=30),
                    redacted_display=(
                        "https://private.example/[private-object]"
                    ),
                ),
                job_timeout_seconds=20,
                cancellation_check=_never_cancel,
                cancellation_event=asyncio.Event(),
                lease_lost_event=asyncio.Event(),
                stop_event=asyncio.Event(),
            )
        )
    details = json.dumps(error.value.details)
    assert "super-secret" not in details
    assert "private.example" not in details
    assert "https://" not in details


def test_config_validation_and_registration(monkeypatch, tmp_path):
    keys = [
        "ENABLE_MEDIA_PROBE_HANDLER",
        "FFPROBE_BINARY",
        "MEDIA_PROBE_TIMEOUT_SECONDS",
        "MEDIA_PROBE_SIGNED_URL_TTL_SECONDS",
        "MEDIA_PROBE_MAX_STDOUT_BYTES",
        "MEDIA_PROBE_STORAGE_BACKEND",
        "MEDIA_PROBE_LOCAL_STORAGE_ROOT",
    ]
    for key in keys:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("FFPROBE_BINARY", str(tmp_path / "missing-disabled"))
    assert MediaProbeConfig.from_env().enabled is False
    registry = JobHandlerRegistry()
    assert (
        _run(
            register_media_probe_if_enabled(
                registry, DurableDatabase("unused")
            )
        )
        is None
    )
    assert registry.supported_job_types == ()

    monkeypatch.setenv("ENABLE_MEDIA_PROBE_HANDLER", "true")
    monkeypatch.setenv("MEDIA_PROBE_TIMEOUT_SECONDS", "120")
    with pytest.raises(JobOrchestrationError):
        MediaProbeConfig.from_env()
    monkeypatch.setenv("MEDIA_PROBE_TIMEOUT_SECONDS", "45")
    monkeypatch.setenv("MEDIA_PROBE_SIGNED_URL_TTL_SECONDS", "50")
    with pytest.raises(JobOrchestrationError):
        MediaProbeConfig.from_env()
    monkeypatch.setenv("MEDIA_PROBE_SIGNED_URL_TTL_SECONDS", "120")
    monkeypatch.setenv("MEDIA_PROBE_MAX_STDOUT_BYTES", "0")
    with pytest.raises(JobOrchestrationError):
        MediaProbeConfig.from_env()
    monkeypatch.setenv("MEDIA_PROBE_MAX_STDOUT_BYTES", "1048576")
    monkeypatch.setenv("FFPROBE_BINARY", "relative/path/ffprobe")
    with pytest.raises(JobOrchestrationError):
        MediaProbeConfig.from_env()

    monkeypatch.setenv("FFPROBE_BINARY", str(tmp_path / "missing-ffprobe"))
    config = MediaProbeConfig.from_env()
    with pytest.raises(JobOrchestrationError):
        _run(FFprobeRunner(config).validate_available())

    ffprobe = shutil.which("ffprobe")
    if ffprobe:
        monkeypatch.setenv("FFPROBE_BINARY", ffprobe)
        monkeypatch.setenv("MEDIA_PROBE_STORAGE_BACKEND", "local")
        monkeypatch.setenv("MEDIA_PROBE_LOCAL_STORAGE_ROOT", str(tmp_path))
        enabled_registry = JobHandlerRegistry()
        version = _run(
            register_media_probe_if_enabled(
                enabled_registry, DurableDatabase("unused")
            )
        )
        assert version.startswith("ffprobe version")
        assert enabled_registry.supported_job_types == ("media_probe",)


class _FakeRepository:
    def __init__(self, asset=None, begin_error=None):
        self.asset = asset or {
            "id": uuid4(),
            "storage_bucket": "source-media",
            "storage_path": "owner/asset/source/v1.mp4",
            "mime_type": "video/mp4",
            "display_name": "sample.mp4",
        }
        self.begin_error = begin_error
        self.finalized = None
        self.failed = None
        self.released = False

    async def begin_probe(self, context, job_input):
        if self.begin_error:
            raise self.begin_error
        self.asset["id"] = job_input.mediaAssetId
        return self.asset

    async def finalize_success(self, context, job_input, result):
        self.finalized = result.model_dump(mode="json")
        return self.finalized

    async def finalize_permanent_failure(
        self, context, job_input, failure
    ):
        self.failed = failure.code

    async def release_after_cancellation(self, context, job_input):
        self.released = True


class _FakeStorage:
    def __init__(self, *, error=None, source_value="https://private.example/x?token=secret"):
        self.error = error
        self.source_value = source_value

    async def inspect_object(self, *, bucket, path):
        if self.error:
            raise self.error
        return StorageObjectMetadata(
            bucket=bucket,
            path=path,
            size_bytes=1000,
            mime_type="video/mp4",
        )

    @asynccontextmanager
    async def open_probe_source(self, *, bucket, path, expires_in):
        if self.error:
            raise self.error
        yield ProbeSource(
            kind="ephemeral_url",
            value=self.source_value,
            expires_at=datetime.now(timezone.utc)
            + timedelta(seconds=expires_in),
            redacted_display="https://private.example/[private-object]",
        )


class _FakeRunner:
    def __init__(self, outcome):
        self.outcome = outcome

    async def run(self, source, **kwargs):
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        return json.dumps(self.outcome).encode()


def _context(*, attempt=1, maximum=3, cancelled=False, lease_lost=False):
    cancellation_event = asyncio.Event()
    lease_lost_event = asyncio.Event()
    if cancelled:
        cancellation_event.set()
    if lease_lost:
        lease_lost_event.set()

    async def heartbeat_callback(**kwargs):
        if lease_lost_event.is_set():
            raise JobOrchestrationError(
                "job_lease_lost", "Lease lost"
            )
        return {"status": "running", **kwargs}

    async def cancellation_callback():
        return cancellation_event.is_set()

    return JobExecutionContext(
        job_id=uuid4(),
        attempt_number=attempt,
        worker_id="worker-test",
        claim_token=uuid4(),
        heartbeat_callback=heartbeat_callback,
        cancellation_callback=cancellation_callback,
        shutdown_event=asyncio.Event(),
        cancellation_event=cancellation_event,
        lease_lost_event=lease_lost_event,
        maximum_attempts=maximum,
        execution_timeout_seconds=30,
    )


def _handler(repository, runner, storage=None):
    return MediaProbeJobHandler(
        config=_config(),
        storage=storage or _FakeStorage(),
        repository=repository,
        runner=runner,
        normalizer=_normalizer(),
    )


def test_handler_success_is_finalized_and_contains_no_source():
    repository = _FakeRepository()
    source = "https://private.example/x?token=secret"
    handler = _handler(
        repository,
        _FakeRunner(_payload(_video_stream(), _audio_stream())),
        _FakeStorage(source_value=source),
    )
    result = _run(
        handler.execute(
            _context(), _input(mediaAssetId=str(uuid4())).model_dump(mode="json")
        )
    )
    assert result.finalized is True
    serialized = json.dumps(result.output)
    assert "https://" not in serialized
    assert "token=secret" not in serialized
    handler.validate_output(result.output)


def test_handler_audio_only_result_is_deterministic():
    first_repository = _FakeRepository()
    first_handler = _handler(
        first_repository,
        _FakeRunner(_payload(_audio_stream(index=0))),
    )
    payload = _input().model_dump(mode="json")
    first = _run(first_handler.execute(_context(), payload))
    second_repository = _FakeRepository()
    second = _run(
        _handler(
            second_repository,
            _FakeRunner(_payload(_audio_stream(index=0))),
        ).execute(_context(), payload)
    )
    assert first.output == second.output
    assert first.output["mediaKind"] == "audio"
    assert first.output["video"] is None
    assert first.output["audio"]["codecName"] == "aac"


@pytest.mark.parametrize(
    ("code", "retryable", "attempt", "finalized"),
    [
        ("probe_source_unavailable", True, 1, False),
        ("ffprobe_timeout", True, 3, True),
        ("ffprobe_no_supported_streams", False, 1, True),
    ],
)
def test_handler_failure_classification(code, retryable, attempt, finalized):
    repository = _FakeRepository()
    handler = _handler(
        repository,
        _FakeRunner(
            ProcessingJobFailure(
                code, "Safe failure", retryable=retryable
            )
        ),
    )
    with pytest.raises(ProcessingJobFailure) as error:
        _run(
            handler.execute(
                _context(attempt=attempt, maximum=3),
                _input().model_dump(mode="json"),
            )
        )
    assert error.value.finalized is finalized
    assert repository.failed == (code if finalized else None)


def test_handler_authorization_failure_is_retryable():
    repository = _FakeRepository()
    handler = _handler(
        repository,
        _FakeRunner(_payload(_video_stream())),
        _FakeStorage(
            error=StorageError(
                "signed_url_failed", "private URL with token=secret"
            )
        ),
    )
    with pytest.raises(ProcessingJobFailure) as error:
        _run(
            handler.execute(
                _context(), _input().model_dump(mode="json")
            )
        )
    assert error.value.code == "probe_source_unavailable"
    assert error.value.retryable is True
    assert "secret" not in error.value.safe_message


def test_handler_cancellation_releases_probe_and_lease_loss_does_not_commit():
    repository = _FakeRepository()
    cancelled = _handler(
        repository, _FakeRunner(MediaProbeCancelled())
    )
    with pytest.raises(asyncio.CancelledError):
        _run(
            cancelled.execute(
                _context(), _input().model_dump(mode="json")
            )
        )
    assert repository.released is True

    repository = _FakeRepository()
    lease_lost = _handler(
        repository,
        _FakeRunner(
            JobOrchestrationError("job_lease_lost", "Lease lost")
        ),
    )
    with pytest.raises(JobOrchestrationError):
        _run(
            lease_lost.execute(
                _context(), _input().model_dump(mode="json")
            )
        )
    assert repository.finalized is None
    assert repository.failed is None


@pytest.mark.parametrize(
    "failure",
    [
        ProcessingJobFailure(
            "media_asset_not_found", "Missing", retryable=False
        ),
        ProcessingJobFailure(
            "media_asset_deleted", "Deleted", retryable=False
        ),
        ProcessingJobFailure(
            "media_asset_not_ready_for_probe", "Not ready", retryable=False
        ),
        ProcessingJobFailure(
            "media_asset_revision_mismatch", "Replaced", retryable=False
        ),
        ProcessingJobFailure(
            "storage_object_revision_mismatch", "Replaced", retryable=False
        ),
    ],
)
def test_handler_rejects_invalid_asset_before_ffprobe(failure):
    repository = _FakeRepository(begin_error=failure)
    handler = _handler(
        repository, _FakeRunner(_payload(_video_stream()))
    )
    with pytest.raises(ProcessingJobFailure) as error:
        _run(
            handler.execute(
                _context(), _input().model_dump(mode="json")
            )
        )
    assert error.value.code == failure.code
    assert repository.finalized is None
