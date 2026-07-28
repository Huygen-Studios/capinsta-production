from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from fractions import Fraction
from pathlib import PurePosixPath
from typing import Any

from server.clipping_jobs.errors import ProcessingJobFailure

from .contracts import (
    MediaProbeJobInputV1,
    MediaProbeResultV1,
    ProbeAudioV1,
    ProbeContainerV1,
    ProbeVideoV1,
)

_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
_VIDEO_EXTENSIONS = {"mp4", "mov", "m4v", "webm", "mkv", "avi"}
_AUDIO_EXTENSIONS = {"wav", "mp3", "m4a", "aac", "ogg", "opus", "flac", "webm"}


def _failure(code: str, message: str) -> ProcessingJobFailure:
    return ProcessingJobFailure(code, message, retryable=False)


def parse_ffprobe_json(payload: bytes, *, maximum_bytes: int) -> dict[str, Any]:
    if len(payload) > maximum_bytes:
        raise _failure(
            "ffprobe_output_too_large",
            "FFprobe returned more metadata than allowed",
        )
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise _failure(
            "ffprobe_output_invalid", "FFprobe returned malformed JSON"
        ) from exc
    if not isinstance(value, dict):
        raise _failure(
            "ffprobe_output_invalid", "FFprobe output must be an object"
        )
    if not isinstance(value.get("format"), dict):
        raise _failure(
            "ffprobe_output_invalid", "FFprobe output has no format object"
        )
    if not isinstance(value.get("streams"), list):
        raise _failure(
            "ffprobe_output_invalid", "FFprobe output has no streams array"
        )
    if len(value["streams"]) > 1024 or any(
        not isinstance(stream, dict) for stream in value["streams"]
    ):
        raise _failure(
            "ffprobe_output_invalid", "FFprobe streams are invalid"
        )
    return value


def _text(value: Any, warnings: set[str], field: str) -> str | None:
    if value is None:
        return None
    cleaned = _CONTROL_CHARACTERS.sub("", str(value)).strip()
    if not cleaned or cleaned in {"N/A", "unknown"}:
        return None
    if len(cleaned) > 200:
        warnings.add(f"{field}_truncated")
        cleaned = cleaned[:200]
    return cleaned


def _integer(
    value: Any,
    *,
    minimum: int = 0,
    maximum: int = 9_223_372_036_854_775_807,
) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = int(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if minimum <= parsed <= maximum else None


def parse_duration_ms(value: Any, *, maximum_ms: int) -> int:
    try:
        duration = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise _failure(
            "ffprobe_duration_unavailable", "Media duration is invalid"
        ) from exc
    if not duration.is_finite() or duration < 0:
        raise _failure(
            "ffprobe_duration_unavailable", "Media duration is invalid"
        )
    milliseconds = int(
        (duration * Decimal(1000)).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )
    if milliseconds > maximum_ms:
        raise _failure(
            "media_metadata_invalid", "Media duration exceeds the probe policy"
        )
    return milliseconds


def parse_frame_rate(
    value: Any, *, maximum_fps: int
) -> tuple[int, int] | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text in {"N/A", "0/0"}:
        return None
    parts = text.split("/")
    if len(parts) != 2:
        return None
    try:
        numerator, denominator = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if numerator <= 0 or denominator <= 0:
        return None
    fraction = Fraction(numerator, denominator)
    if fraction > maximum_fps:
        return None
    return fraction.numerator, fraction.denominator


def _stream_index(stream: dict[str, Any]) -> int:
    return _integer(stream.get("index"), maximum=1_000_000) or 0


def _is_default(stream: dict[str, Any]) -> bool:
    disposition = stream.get("disposition")
    return isinstance(disposition, dict) and disposition.get("default") in {
        1,
        "1",
        True,
    }


def _is_attached_picture(stream: dict[str, Any]) -> bool:
    disposition = stream.get("disposition")
    return isinstance(disposition, dict) and disposition.get("attached_pic") in {
        1,
        "1",
        True,
    }


def select_primary_video(
    streams: list[dict[str, Any]],
) -> dict[str, Any] | None:
    candidates = [
        stream
        for stream in streams
        if stream.get("codec_type") == "video"
        and not _is_attached_picture(stream)
        and (_integer(stream.get("width"), minimum=1) or 0) > 0
        and (_integer(stream.get("height"), minimum=1) or 0) > 0
    ]
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda stream: (
            -int(_is_default(stream)),
            -(
                (_integer(stream.get("width"), minimum=1) or 0)
                * (_integer(stream.get("height"), minimum=1) or 0)
            ),
            _stream_index(stream),
        ),
    )


def select_primary_audio(
    streams: list[dict[str, Any]],
) -> dict[str, Any] | None:
    candidates = [
        stream for stream in streams if stream.get("codec_type") == "audio"
    ]
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda stream: (
            -int(_is_default(stream)),
            -(_integer(stream.get("channels"), minimum=1, maximum=128) or 0),
            -(
                _integer(
                    stream.get("sample_rate"), minimum=1, maximum=768_000
                )
                or 0
            ),
            _stream_index(stream),
        ),
    )


def _rotation(
    stream: dict[str, Any], warnings: set[str]
) -> int:
    raw: Any = None
    side_data = stream.get("side_data_list")
    if isinstance(side_data, list):
        for item in side_data:
            if isinstance(item, dict) and item.get("rotation") is not None:
                raw = item["rotation"]
                break
    tags = stream.get("tags")
    if raw is None and isinstance(tags, dict):
        raw = tags.get("rotate")
    if raw is None:
        return 0
    try:
        degrees = Decimal(str(raw))
    except InvalidOperation:
        warnings.add("invalid_rotation")
        return 0
    if not degrees.is_finite():
        warnings.add("invalid_rotation")
        return 0
    normalized = int(degrees.to_integral_value(rounding=ROUND_HALF_UP)) % 360
    nearest = min((0, 90, 180, 270), key=lambda candidate: abs(candidate - normalized))
    circular_distance = min(
        abs(nearest - normalized), 360 - abs(nearest - normalized)
    )
    if circular_distance > 1:
        warnings.add("invalid_rotation")
        return 0
    return nearest


def _duration_from_sources(
    format_data: dict[str, Any],
    primary_video: dict[str, Any] | None,
    primary_audio: dict[str, Any] | None,
    streams: list[dict[str, Any]],
    *,
    maximum_ms: int,
    warnings: set[str],
) -> int:
    sources = [
        format_data.get("duration"),
        primary_video.get("duration") if primary_video else None,
        primary_audio.get("duration") if primary_audio else None,
    ]
    stream_durations: list[tuple[int, Any]] = []
    for stream in streams:
        if stream.get("codec_type") not in {"video", "audio"}:
            continue
        value = stream.get("duration")
        if value is None:
            continue
        try:
            stream_durations.append(
                (parse_duration_ms(value, maximum_ms=maximum_ms), value)
            )
        except ProcessingJobFailure:
            warnings.add("invalid_stream_duration")
    if stream_durations:
        sources.append(max(stream_durations, key=lambda item: item[0])[1])
    for index, value in enumerate(sources):
        if value is None or value == "" or value == "N/A":
            continue
        try:
            result = parse_duration_ms(value, maximum_ms=maximum_ms)
        except ProcessingJobFailure:
            warnings.add("invalid_duration_value")
            continue
        if index > 0:
            warnings.add("duration_stream_fallback")
        return result
    raise _failure(
        "ffprobe_duration_unavailable",
        "Media duration could not be determined",
    )


def _mime_warnings(
    *,
    media_kind: str,
    declared_mime: str | None,
    storage_mime: str | None,
    display_name: str,
    format_name: str | None,
    warnings: set[str],
) -> None:
    declared = (declared_mime or "").split(";", 1)[0].lower()
    stored = (storage_mime or "").split(";", 1)[0].lower()
    if declared and not declared.startswith(f"{media_kind}/"):
        warnings.add("declared_mime_mismatch")
    if stored and not stored.startswith(f"{media_kind}/"):
        warnings.add("storage_mime_mismatch")
    extension = PurePosixPath(display_name).suffix.lower().lstrip(".")
    allowed = _VIDEO_EXTENSIONS if media_kind == "video" else _AUDIO_EXTENSIONS
    if extension and extension not in allowed:
        warnings.add("container_extension_mismatch")
    if extension == "webm" and format_name and "webm" not in format_name:
        warnings.add("container_extension_mismatch")


class MediaProbeNormalizer:
    def __init__(self, *, maximum_duration_ms: int, maximum_fps: int) -> None:
        self.maximum_duration_ms = maximum_duration_ms
        self.maximum_fps = maximum_fps

    def normalize(
        self,
        parsed: dict[str, Any],
        *,
        job_input: MediaProbeJobInputV1,
        declared_mime: str | None,
        storage_mime: str | None,
        display_name: str,
    ) -> MediaProbeResultV1:
        warnings: set[str] = set()
        format_data = parsed["format"]
        streams = parsed["streams"]
        video_stream = select_primary_video(streams)
        audio_stream = select_primary_audio(streams)
        if video_stream is None and audio_stream is None:
            raise _failure(
                "ffprobe_no_supported_streams",
                "Media contains no supported audio or video stream",
            )
        media_kind = "video" if video_stream is not None else "audio"
        duration_ms = _duration_from_sources(
            format_data,
            video_stream,
            audio_stream,
            streams,
            maximum_ms=self.maximum_duration_ms,
            warnings=warnings,
        )
        format_name = _text(
            format_data.get("format_name"), warnings, "format_name"
        )
        _mime_warnings(
            media_kind=media_kind,
            declared_mime=declared_mime,
            storage_mime=storage_mime,
            display_name=display_name,
            format_name=format_name,
            warnings=warnings,
        )
        video = None
        if video_stream is not None:
            encoded_width = _integer(
                video_stream.get("width"), minimum=1, maximum=65_535
            )
            encoded_height = _integer(
                video_stream.get("height"), minimum=1, maximum=65_535
            )
            if encoded_width is None or encoded_height is None:
                raise _failure(
                    "media_metadata_invalid", "Video dimensions are invalid"
                )
            rotation = _rotation(video_stream, warnings)
            width, height = encoded_width, encoded_height
            if rotation in {90, 270}:
                width, height = height, width
            fps = parse_frame_rate(
                video_stream.get("avg_frame_rate"),
                maximum_fps=self.maximum_fps,
            )
            if fps is None:
                fps = parse_frame_rate(
                    video_stream.get("r_frame_rate"),
                    maximum_fps=self.maximum_fps,
                )
                if fps is not None:
                    warnings.add("fps_r_frame_rate_fallback")
            if fps is None:
                warnings.add("fps_unavailable")
            video = ProbeVideoV1(
                codecName=_text(
                    video_stream.get("codec_name"), warnings, "video_codec"
                ),
                codecLongName=_text(
                    video_stream.get("codec_long_name"),
                    warnings,
                    "video_codec_long",
                ),
                profile=_text(
                    video_stream.get("profile"), warnings, "video_profile"
                ),
                width=width,
                height=height,
                encodedWidth=encoded_width,
                encodedHeight=encoded_height,
                codedWidth=_integer(
                    video_stream.get("coded_width"),
                    minimum=1,
                    maximum=65_535,
                ),
                codedHeight=_integer(
                    video_stream.get("coded_height"),
                    minimum=1,
                    maximum=65_535,
                ),
                rotationDegrees=rotation,
                fpsNumerator=fps[0] if fps else None,
                fpsDenominator=fps[1] if fps else None,
                pixelFormat=_text(
                    video_stream.get("pix_fmt"), warnings, "pixel_format"
                ),
                bitRate=_integer(video_stream.get("bit_rate")),
                streamIndex=_stream_index(video_stream),
            )
        audio = None
        if audio_stream is not None:
            audio = ProbeAudioV1(
                codecName=_text(
                    audio_stream.get("codec_name"), warnings, "audio_codec"
                ),
                codecLongName=_text(
                    audio_stream.get("codec_long_name"),
                    warnings,
                    "audio_codec_long",
                ),
                sampleRateHz=_integer(
                    audio_stream.get("sample_rate"),
                    minimum=1,
                    maximum=768_000,
                ),
                channels=_integer(
                    audio_stream.get("channels"), minimum=1, maximum=128
                ),
                channelLayout=_text(
                    audio_stream.get("channel_layout"),
                    warnings,
                    "channel_layout",
                ),
                bitRate=_integer(audio_stream.get("bit_rate")),
                streamIndex=_stream_index(audio_stream),
            )
        return MediaProbeResultV1(
            mediaAssetId=job_input.mediaAssetId,
            mediaAssetRevision=job_input.expectedMediaRevision + 1,
            mediaKind=media_kind,
            durationMs=duration_ms,
            container=ProbeContainerV1(
                formatName=format_name,
                formatLongName=_text(
                    format_data.get("format_long_name"),
                    warnings,
                    "format_long_name",
                ),
                bitRate=_integer(format_data.get("bit_rate")),
                sizeBytes=_integer(format_data.get("size")),
            ),
            video=video,
            audio=audio,
            streamCount=len(streams),
            warnings=sorted(warnings),
            metadata={},
        )


__all__ = [
    "MediaProbeNormalizer",
    "parse_duration_ms",
    "parse_ffprobe_json",
    "parse_frame_rate",
    "select_primary_audio",
    "select_primary_video",
]
