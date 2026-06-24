import os
import subprocess
import shutil
import logging
from pydub import AudioSegment
from dotenv import load_dotenv

# Initialize pydub with the correct ffmpeg path from .env
load_dotenv()
ffmpeg_path = os.getenv("FFMPEG_PATH")
if ffmpeg_path and os.path.exists(ffmpeg_path):
    AudioSegment.converter = ffmpeg_path
FFMPEG_BINARY = ffmpeg_path if ffmpeg_path and os.path.exists(ffmpeg_path) else "ffmpeg"
logger = logging.getLogger(__name__)

from .config import (
    CHUNK_SIZE_NORMAL, CHUNK_OVERLAP_NORMAL,
    CHUNK_SIZE_STRICT, CHUNK_OVERLAP_STRICT
)

class Chunk:
    def __init__(self, index: int, audio_path: str, start_time: float, end_time: float):
        self.index = index
        self.audio_path = audio_path
        self.start_time = start_time
        self.end_time = end_time
        
        # Pipeline fields
        self.raw_text = None
        self.llm_text = None
        self.final_text = None
        self.tokens = []
        self.language = None
        self.alignment = None
        self.asr_metadata = None

def extract_audio(
    video_path: str,
    output_path: str,
    *,
    sample_rate: int = 16000,
    channels: int = 1,
    codec: str = "libmp3lame",
    bitrate_kbps: int | None = 64,
) -> str:
    """Extract mono audio for transcription and alignment."""
    if not shutil.which(FFMPEG_BINARY) and not os.path.exists(FFMPEG_BINARY):
        raise RuntimeError("FFmpeg is not available. Install FFmpeg or set FFMPEG_PATH to the ffmpeg executable.")

    ffmpeg_cmd = [
        FFMPEG_BINARY, "-i", video_path,
        "-vn",
        "-ac", str(max(1, min(int(channels), 2))),
        "-ar", str(max(8000, min(int(sample_rate), 48000))),
        "-c:a", codec or "libmp3lame",
    ]
    if bitrate_kbps:
        ffmpeg_cmd.extend(["-b:a", f"{int(bitrate_kbps)}k"])
    ffmpeg_cmd.extend([
        output_path,
        "-y"
    ])
    try:
        subprocess.run(ffmpeg_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"FFmpeg audio extraction failed: {detail[-600:] or exc}") from exc
    return output_path

def _float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def build_vad_chunk_ranges(
    speech_segments: list[dict],
    duration_seconds: float,
    *,
    target_seconds: float = 15.0,
    max_seconds: float = 25.0,
    padding_seconds: float = 0.08,
) -> list[tuple[float, float]]:
    """Group speech intervals and cut at natural gaps while preserving global time."""
    duration = max(0.0, float(duration_seconds))
    if duration <= 0:
        return []
    target = max(3.0, min(float(target_seconds), float(max_seconds)))
    maximum = max(target, float(max_seconds))
    padding = max(0.0, min(0.25, float(padding_seconds)))
    speech = sorted(
        (
            max(0.0, float(segment.get("start", 0.0))),
            min(duration, float(segment.get("end", 0.0))),
        )
        for segment in speech_segments
        if float(segment.get("end", 0.0)) > float(segment.get("start", 0.0))
    )
    if not speech:
        return []

    ranges: list[tuple[float, float]] = []
    group_start, group_end = speech[0]

    def emit(start: float, end: float) -> None:
        cursor = start
        while end - cursor > maximum:
            ranges.append((cursor, cursor + maximum))
            cursor += maximum
        if end > cursor:
            ranges.append((cursor, end))

    for start, end in speech[1:]:
        proposed_end = max(group_end, end)
        if proposed_end - group_start > maximum or (
            group_end - group_start >= target and start > group_end
        ):
            emit(max(0.0, group_start - padding), min(duration, group_end + padding))
            group_start, group_end = start, end
        else:
            group_end = proposed_end
    emit(max(0.0, group_start - padding), min(duration, group_end + padding))

    return [
        (round(max(0.0, start), 3), round(min(duration, end), 3))
        for start, end in ranges
        if end - start >= 0.05
    ]


def overlap_chunk(
    audio_path: str,
    profile: str = "balanced",
    mode: str = "normal",
    speech_segments: list[dict] | None = None,
    *,
    vad_enabled: bool | None = None,
    target_seconds: float | None = None,
    max_seconds: float | None = None,
    padding_seconds: float | None = None,
    legacy_seconds: float | None = None,
    legacy_overlap_seconds: float | None = None,
) -> list[Chunk]:
    """Split at VAD pauses when available, otherwise use legacy overlap chunks."""
    audio = AudioSegment.from_file(audio_path)
    dur_seconds = len(audio) / 1000.0
    
    if mode == 'strict':
        size = legacy_seconds if legacy_seconds is not None else CHUNK_SIZE_STRICT
        overlap = legacy_overlap_seconds if legacy_overlap_seconds is not None else CHUNK_OVERLAP_STRICT
    else:
        size = legacy_seconds if legacy_seconds is not None else CHUNK_SIZE_NORMAL
        overlap = legacy_overlap_seconds if legacy_overlap_seconds is not None else CHUNK_OVERLAP_NORMAL
        
    use_vad = (
        os.getenv("VAD_CHUNKING_ENABLED", "true").strip().lower() == "true"
        if vad_enabled is None
        else bool(vad_enabled)
    )
    ranges = (
        build_vad_chunk_ranges(
            speech_segments or [],
            dur_seconds,
            target_seconds=target_seconds if target_seconds is not None else _float_env("VAD_TARGET_CHUNK_SECONDS", 15.0),
            max_seconds=max_seconds if max_seconds is not None else _float_env("VAD_MAX_CHUNK_SECONDS", 25.0),
            padding_seconds=padding_seconds if padding_seconds is not None else _float_env("VAD_CHUNK_PADDING_SECONDS", 0.08),
        )
        if use_vad and speech_segments
        else []
    )
    if not ranges:
        start = 0.0
        while start < dur_seconds:
            end = min(start + size, dur_seconds)
            ranges.append((start, end))
            if end == dur_seconds:
                break
            start += size - overlap
        chunk_mode = "legacy_overlap"
    else:
        chunk_mode = "vad"
    logger.info(
        "audio_chunking mode=%s chunks=%s duration=%.3f",
        chunk_mode,
        len(ranges),
        dur_seconds,
    )

    chunks = []
    for index, (start, end) in enumerate(ranges):
        seg = audio[round(start * 1000) : round(end * 1000)]
        chunk_path = f"{audio_path}_chunk_{index}.mp3"
        seg.export(chunk_path, format="mp3")
        chunks.append(Chunk(index=index, audio_path=chunk_path, start_time=start, end_time=end))
    return chunks

def apply_fade(chunk_path: str, fade_ms: int = 50) -> None:
    """Applies a quick crossfade to avoid pops on chunk boundaries."""
    try:
        audio = AudioSegment.from_file(chunk_path)
        audio = audio.fade_in(fade_ms).fade_out(fade_ms)
        export_format = os.path.splitext(chunk_path)[1].lstrip('.') or "wav"
        audio.export(chunk_path, format=export_format)
    except Exception:
        pass  # safe fallback
