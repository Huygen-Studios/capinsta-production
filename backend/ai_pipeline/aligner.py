from __future__ import annotations

import difflib
import logging
import math
import os
import re
from typing import Any

try:
    from .config import RETRY_ALIGN
    from .retry import with_retry
except ImportError:
    import sys

    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from config import RETRY_ALIGN
    from retry import with_retry

logger = logging.getLogger(__name__)

DEFAULT_PAUSE_SPLIT_THRESHOLD = 0.45
MIN_WORD_DURATION_SECONDS = 0.02
MIN_CADENCE_STEP_SECONDS = 0.075
MAX_CADENCE_STEP_SECONDS = 0.35
CODE_MIXED_MODES = {"telgish", "teluglish", "hinglish", "auto_mixed_indian"}
_FALSE_ENV_VALUES = {"0", "false", "no", "off", "disabled"}
_TRUE_ENV_VALUES = {"1", "true", "yes", "on", "enabled"}


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in _TRUE_ENV_VALUES:
        return True
    if value in _FALSE_ENV_VALUES:
        return False
    return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)) or default)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    except (TypeError, ValueError):
        return None


def _round_time(value: float) -> float:
    return round(max(0.0, float(value)), 3)


def _word_text(word: dict[str, Any]) -> str:
    return str(word.get("word") or word.get("text") or "").strip()


def _normalize_token(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _merge_timing_source(previous: Any, source: str) -> str:
    previous_text = str(previous or "").strip()
    if not previous_text:
        return source

    parts = [part for part in re.split(r"[+|]", previous_text) if part]
    if source not in parts:
        parts.append(source)
    return "+".join(parts)


def _set_timing_source(word: dict[str, Any], source: str, *, append: bool = True) -> None:
    previous = word.get("timingSource") or word.get("timing_source")
    detailed_source = _merge_timing_source(previous, source) if append else source
    word["timing_source"] = detailed_source
    word["timingSource"] = detailed_source
    word["timingSourceDetail"] = detailed_source


def _copy_word(raw_word: dict[str, Any]) -> dict[str, Any]:
    copied = dict(raw_word)
    start = _safe_float(copied.get("start"))
    end = _safe_float(copied.get("end"))
    if start is not None:
        copied["start"] = _round_time(start)
    if end is not None:
        copied["end"] = _round_time(end)
    if copied.get("timingSource") and not copied.get("timing_source"):
        copied["timing_source"] = copied["timingSource"]
    if copied.get("timing_source") and not copied.get("timingSource"):
        copied["timingSource"] = copied["timing_source"]
    return copied


def _copy_words(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_copy_word(word) for word in words if isinstance(word, dict)]


class TranscriptAligner:
    """
    Final timestamp optimizer for provider words before the normalized transcript
    reaches the editor. It never owns text reconstruction; it only tightens word
    timing and keeps the original word objects intact.
    """

    def __init__(
        self,
        *,
        enable_silero_vad: bool | None = None,
        enable_stable_ts: bool | None = None,
        enable_whisperx: bool | None = None,
        pause_threshold: float | None = None,
    ) -> None:
        self.enable_silero_vad = (
            _env_bool("ENABLE_SILERO_VAD", False)
            if enable_silero_vad is None
            else bool(enable_silero_vad)
        )
        self.enable_stable_ts = (
            _env_bool("ENABLE_STABLE_TS", False)
            if enable_stable_ts is None
            else bool(enable_stable_ts)
        )
        self.enable_whisperx = (
            _env_bool("ENABLE_WHISPERX", False)
            if enable_whisperx is None
            else bool(enable_whisperx)
        )
        self.pause_threshold = max(
            0.05,
            float(
                pause_threshold
                if pause_threshold is not None
                else _env_float("PAUSE_SPLIT_THRESHOLD", DEFAULT_PAUSE_SPLIT_THRESHOLD)
            ),
        )
        self._silero_model: Any | None = None
        self._silero_device = "cpu"
        self._stable_ts_model: Any | None = None
        self._stable_ts_model_name: str | None = None
        self._vad_cache: dict[tuple[str, float, float], dict[str, Any]] = {}

    def status(self) -> dict[str, Any]:
        return {
            "enableSileroVad": self.enable_silero_vad,
            "enableStableTs": self.enable_stable_ts,
            "enableWhisperx": self.enable_whisperx,
            "pauseSplitThreshold": self.pause_threshold,
            "stableTsModel": os.getenv("STABLE_TS_MODEL", "base"),
            "sileroVadDevice": self._silero_device,
        }

    def snap_timestamps_to_vad(
        self,
        audio_path: str,
        words: list[dict[str, Any]],
        pause_threshold: float | None = None,
    ) -> list[dict[str, Any]]:
        processed_words = _copy_words(words)
        if not processed_words or not self.enable_silero_vad:
            return processed_words

        threshold = max(
            0.05,
            float(pause_threshold if pause_threshold is not None else self.pause_threshold),
        )
        try:
            speech_map = self._compute_vad_speech_map(audio_path)
        except Exception as exc:
            logger.warning(
                "Silero VAD timestamp snapping failed for %s: %s. Raw provider timestamps will be used.",
                audio_path,
                exc,
            )
            return processed_words

        speech_ranges = speech_map.get("speechRanges") or []
        if not speech_ranges:
            logger.warning("Silero VAD found no speech ranges for %s. Raw provider timestamps will be used.", audio_path)
            return processed_words

        snapped_count = 0
        audio_duration = _safe_float(speech_map.get("duration")) or 0.0
        for word in processed_words:
            start = _safe_float(word.get("start"))
            end = _safe_float(word.get("end"))
            if start is None or end is None or end <= start:
                continue

            match = self._speech_range_for_word(start, end, speech_ranges)
            if match is None:
                continue

            range_index, speech_range = match
            speech_end = float(speech_range["end"])
            if speech_end <= start + MIN_WORD_DURATION_SECONDS or end <= speech_end + 0.02:
                continue

            if range_index + 1 < len(speech_ranges):
                next_speech_start = float(speech_ranges[range_index + 1]["start"])
            else:
                next_speech_start = audio_duration
            verified_silence = max(0.0, next_speech_start - speech_end)

            if verified_silence < threshold:
                continue

            new_end = max(start + MIN_WORD_DURATION_SECONDS, speech_end)
            if new_end >= end - 0.005:
                continue

            original_end = end
            word["end"] = _round_time(new_end)
            word["vadSilenceClampedSeconds"] = round(original_end - new_end, 3)
            _set_timing_source(word, "vad_snapped")
            snapped_count += 1

        if snapped_count:
            logger.info(
                "Silero VAD snapped %s word end timestamp(s) for %s pause_threshold=%.3f",
                snapped_count,
                audio_path,
                threshold,
            )
        return processed_words

    def align_code_mixed_tokens(
        self,
        audio_path: str,
        words: list[dict[str, Any]],
        language_mode: str,
    ) -> list[dict[str, Any]]:
        processed_words = _copy_words(words)
        if not processed_words:
            return processed_words

        if self.enable_stable_ts:
            try:
                stable_words = self._stable_ts_word_timestamps(audio_path, language_mode)
                adjusted_words = self._apply_stable_ts_matches(processed_words, stable_words)
                if self.enable_silero_vad:
                    adjusted_words = self.snap_timestamps_to_vad(
                        audio_path,
                        adjusted_words,
                        self.pause_threshold,
                    )
                logger.info(
                    "stable-ts adjusted code-mixed tokens audio=%s words=%s language_mode=%s",
                    audio_path,
                    len(adjusted_words),
                    language_mode,
                )
                return adjusted_words
            except Exception as exc:
                logger.warning(
                    "stable-ts alignment failed for %s language_mode=%s: %s. Falling back to VAD snapping.",
                    audio_path,
                    language_mode,
                    exc,
                )

        if self.enable_silero_vad:
            return self.snap_timestamps_to_vad(audio_path, processed_words, self.pause_threshold)
        return processed_words

    def repair_compressed_word_cadence(
        self,
        words: list[dict[str, Any]],
        segment_start: float | None = None,
        segment_end: float | None = None,
    ) -> list[dict[str, Any]]:
        processed_words = _copy_words(words)
        if len(processed_words) <= 1 or not self._has_compressed_starts(processed_words):
            return processed_words

        starts = [_safe_float(word.get("start")) for word in processed_words]
        ends = [_safe_float(word.get("end")) for word in processed_words]
        numeric_starts = [value for value in starts if value is not None]
        numeric_ends = [value for value in ends if value is not None]
        if not numeric_starts:
            return processed_words

        base_start = _safe_float(segment_start)
        base_end = _safe_float(segment_end)
        phrase_start = max(0.0, base_start if base_start is not None else min(numeric_starts))
        phrase_end = base_end if base_end is not None else max(numeric_ends or [phrase_start])
        phrase_end = max(phrase_start + MIN_WORD_DURATION_SECONDS * len(processed_words), phrase_end)

        available = max(MIN_WORD_DURATION_SECONDS * len(processed_words), phrase_end - phrase_start)
        step = min(MAX_CADENCE_STEP_SECONDS, max(MIN_CADENCE_STEP_SECONDS, available / max(1, len(processed_words))))
        repaired_until = min(phrase_end, phrase_start + step * len(processed_words))
        if repaired_until <= phrase_start + MIN_WORD_DURATION_SECONDS:
            return processed_words

        for index, word in enumerate(processed_words):
            start = min(repaired_until - MIN_WORD_DURATION_SECONDS, phrase_start + index * step)
            next_start = phrase_start + (index + 1) * step if index + 1 < len(processed_words) else repaired_until
            end = min(phrase_end, max(start + MIN_WORD_DURATION_SECONDS, next_start))
            word["start"] = _round_time(start)
            word["end"] = _round_time(end)
            _set_timing_source(word, "cadence_repaired")

        logger.info(
            "repaired compressed word cadence words=%s start=%.3f end=%.3f",
            len(processed_words),
            phrase_start,
            phrase_end,
        )
        return processed_words

    def enforce_temporal_boundaries(self, words: list[dict[str, Any]]) -> list[dict[str, Any]]:
        processed_words = _copy_words(words)
        if not processed_words:
            return processed_words

        for index, word in enumerate(processed_words):
            start = _safe_float(word.get("start"))
            end = _safe_float(word.get("end"))
            if start is None or end is None:
                continue
            if end <= start:
                word["end"] = _round_time(start + MIN_WORD_DURATION_SECONDS)
                _set_timing_source(word, "temporal_boundary_enforced")

            if index + 1 >= len(processed_words):
                continue

            next_word = processed_words[index + 1]
            next_start = _safe_float(next_word.get("start"))
            if next_start is None:
                continue

            current_start = _safe_float(word.get("start"))
            current_end = _safe_float(word.get("end"))
            if current_start is None or current_end is None or current_end <= next_start:
                continue

            original_start = current_start
            original_end = current_end
            new_end = max(0.0, next_start)
            if new_end <= current_start:
                word["start"] = _round_time(max(0.0, new_end - MIN_WORD_DURATION_SECONDS))
            word["end"] = _round_time(new_end)
            word["temporalBoundaryRepair"] = {
                "from": [_round_time(original_start), _round_time(original_end)],
                "to": [_safe_float(word.get("start")) or 0.0, _safe_float(word.get("end")) or 0.0],
            }
            _set_timing_source(word, "temporal_boundary_enforced")

        return processed_words

    def optimize_segments(
        self,
        audio_path: str,
        segments: list[dict[str, Any]],
        language_mode: str,
    ) -> list[dict[str, Any]]:
        optimized_segments = [dict(segment) for segment in segments]
        flat_words: list[dict[str, Any]] = []
        word_locations: list[tuple[int, int]] = []

        for segment_index, segment in enumerate(optimized_segments):
            segment_words = [_copy_word(word) for word in (segment.get("words") or []) if isinstance(word, dict)]
            segment["words"] = segment_words
            for word_index, word in enumerate(segment_words):
                flat_words.append(word)
                word_locations.append((segment_index, word_index))

        if not flat_words:
            return optimized_segments

        try:
            if str(language_mode).strip().lower() in CODE_MIXED_MODES:
                aligned_words = self.align_code_mixed_tokens(audio_path, flat_words, language_mode)
            else:
                aligned_words = _copy_words(flat_words)
                if self.enable_stable_ts:
                    try:
                        stable_words = self._stable_ts_word_timestamps(audio_path, language_mode)
                        aligned_words = self._apply_stable_ts_matches(aligned_words, stable_words)
                    except Exception as exc:
                        logger.warning(
                            "stable-ts global timing pass failed for %s language_mode=%s: %s",
                            audio_path,
                            language_mode,
                            exc,
                        )
                if self.enable_silero_vad:
                    aligned_words = self.snap_timestamps_to_vad(audio_path, aligned_words, self.pause_threshold)
            aligned_words = self.enforce_temporal_boundaries(aligned_words)
        except Exception as exc:
            logger.warning(
                "Transcript timing optimizer failed for %s: %s. Keeping normalized provider/alignment timestamps.",
                audio_path,
                exc,
            )
            return optimized_segments

        for aligned_word, (segment_index, word_index) in zip(aligned_words, word_locations):
            optimized_segments[segment_index]["words"][word_index] = aligned_word

        for segment in optimized_segments:
            segment_words = segment.get("words") or []
            if not segment_words:
                continue
            segment["words"] = self.repair_compressed_word_cadence(
                segment_words,
                _safe_float(segment.get("start")),
                _safe_float(segment.get("end")),
            )

        for index in range(len(optimized_segments) - 1):
            segment_words = optimized_segments[index].get("words") or []
            next_words = optimized_segments[index + 1].get("words") or []
            if not segment_words or not next_words:
                continue
            next_start = _safe_float(next_words[0].get("start"))
            if next_start is None:
                continue
            trimmed_words: list[dict[str, Any]] = []
            for word in segment_words:
                start = _safe_float(word.get("start"))
                end = _safe_float(word.get("end"))
                if start is None or end is None:
                    continue
                if start >= next_start - 0.001:
                    continue
                if end > next_start:
                    word = dict(word)
                    word["end"] = _round_time(max(start + MIN_WORD_DURATION_SECONDS, next_start - 0.001))
                    _set_timing_source(word, "overlap_tail_trimmed")
                trimmed_words.append(word)
            if trimmed_words:
                optimized_segments[index]["words"] = trimmed_words

        flat_words = []
        word_locations = []
        for segment_index, segment in enumerate(optimized_segments):
            for word_index, word in enumerate(segment.get("words") or []):
                flat_words.append(word)
                word_locations.append((segment_index, word_index))
        aligned_words = self.enforce_temporal_boundaries(flat_words)
        for aligned_word, (segment_index, word_index) in zip(aligned_words, word_locations):
            optimized_segments[segment_index]["words"][word_index] = aligned_word

        for segment in optimized_segments:
            valid_words = [
                word
                for word in (segment.get("words") or [])
                if _safe_float(word.get("start")) is not None and _safe_float(word.get("end")) is not None
            ]
            if not valid_words:
                continue
            segment["start"] = _round_time(float(valid_words[0]["start"]))
            segment["end"] = _round_time(float(valid_words[-1]["end"]))

        return optimized_segments

    def _has_compressed_starts(self, words: list[dict[str, Any]]) -> bool:
        if any(
            "estimated phrase retimed to vad speech" in str(word.get("timing_repair") or "").lower()
            for word in words
        ):
            return False

        starts = [_safe_float(word.get("start")) for word in words]
        durations = [
            (_safe_float(word.get("end")) or 0.0) - (_safe_float(word.get("start")) or 0.0)
            for word in words
            if _safe_float(word.get("start")) is not None and _safe_float(word.get("end")) is not None
        ]
        starts = [start for start in starts if start is not None]
        if len(starts) <= 1:
            return False

        adjacent_gaps = [starts[index] - starts[index - 1] for index in range(1, len(starts))]
        repeated_start = any(abs(gap) <= 0.025 for gap in adjacent_gaps)
        backwards_start = any(gap < -0.001 for gap in adjacent_gaps)
        compressed_span = max(starts) - min(starts) < MIN_CADENCE_STEP_SECONDS * min(3, len(starts) - 1)
        long_flat_word = any(
            ((_safe_float(word.get("end")) or 0.0) - (_safe_float(word.get("start")) or 0.0)) > 1.4
            for word in words
        ) and compressed_span
        interpolated_provider_words = any(
            "interpolated" in str(word.get("timingSource") or word.get("timing_source") or "").lower()
            for word in words
        )
        average_duration = sum(max(0.0, duration) for duration in durations) / len(durations) if durations else 0.0
        stretched_interpolated_cadence = interpolated_provider_words and average_duration > MAX_CADENCE_STEP_SECONDS * 1.5
        return repeated_start or backwards_start or compressed_span or long_flat_word or stretched_interpolated_cadence

    def _pick_torch_device(self, torch_module: Any) -> str:
        requested = (os.getenv("SILERO_VAD_DEVICE") or "auto").strip().lower()
        if requested == "cpu":
            return "cpu"
        if requested == "cuda":
            return "cuda" if torch_module.cuda.is_available() else "cpu"
        return "cuda" if torch_module.cuda.is_available() else "cpu"

    def _load_audio_tensor(self, audio_path: str, target_sample_rate: int = 16000) -> tuple[Any, int]:
        import torch

        waveform = None
        sample_rate = None
        try:
            import torchaudio

            waveform, sample_rate = torchaudio.load(audio_path)
        except Exception as torchaudio_exc:
            logger.info("torchaudio.load failed for %s: %s. Trying soundfile.", audio_path, torchaudio_exc)
            try:
                import soundfile as sf

                samples, sample_rate = sf.read(audio_path, always_2d=False)
                waveform = torch.as_tensor(samples, dtype=torch.float32)
                if waveform.ndim == 2:
                    waveform = waveform.transpose(0, 1)
            except Exception as soundfile_exc:
                raise RuntimeError(f"Could not load audio for VAD: {soundfile_exc}") from soundfile_exc

        if sample_rate is None or waveform is None:
            raise RuntimeError("Could not load audio for VAD.")

        waveform = waveform.float()
        if waveform.ndim == 2:
            waveform = waveform.mean(dim=0)
        elif waveform.ndim > 2:
            waveform = waveform.reshape(-1)
        waveform = waveform.squeeze()

        if int(sample_rate) != target_sample_rate:
            waveform = self._resample_tensor(waveform, int(sample_rate), target_sample_rate, torch)
            sample_rate = target_sample_rate

        max_abs = float(waveform.abs().max().item()) if waveform.numel() else 0.0
        if max_abs > 1.0:
            waveform = waveform / max_abs

        return waveform, int(sample_rate)

    def _resample_tensor(self, waveform: Any, source_rate: int, target_rate: int, torch_module: Any) -> Any:
        try:
            import torchaudio

            return torchaudio.transforms.Resample(source_rate, target_rate)(waveform)
        except Exception:
            import torch.nn.functional as functional

            if waveform.numel() == 0:
                return waveform
            target_length = max(1, int(round(waveform.numel() * target_rate / source_rate)))
            return functional.interpolate(
                waveform.reshape(1, 1, -1),
                size=target_length,
                mode="linear",
                align_corners=False,
            ).reshape(-1).to(dtype=torch_module.float32)

    def _load_silero_model(self) -> tuple[Any, str]:
        if self._silero_model is not None:
            return self._silero_model, self._silero_device

        import torch

        device = self._pick_torch_device(torch)
        hub_error: Exception | None = None
        try:
            try:
                loaded = torch.hub.load(
                    repo_or_dir="snakers4/silero-vad",
                    model="silero_vad",
                    force_reload=False,
                    onnx=False,
                    trust_repo=True,
                )
            except TypeError:
                loaded = torch.hub.load(
                    repo_or_dir="snakers4/silero-vad",
                    model="silero_vad",
                    force_reload=False,
                    onnx=False,
                )
            model = loaded[0] if isinstance(loaded, tuple) else loaded
        except Exception as exc:
            hub_error = exc
            try:
                from silero_vad import load_silero_vad

                model = load_silero_vad()
            except Exception as package_exc:
                raise RuntimeError(
                    f"Could not initialize Silero VAD through torch.hub ({hub_error}) "
                    f"or silero-vad package ({package_exc})."
                ) from package_exc

        try:
            model.to(device)
            self._silero_device = device
        except Exception as exc:
            logger.warning("Silero VAD could not use %s: %s. Falling back to CPU.", device, exc)
            model.to("cpu")
            self._silero_device = "cpu"

        model.eval()
        self._silero_model = model
        return self._silero_model, self._silero_device

    def _compute_vad_speech_map(self, audio_path: str) -> dict[str, Any]:
        cache_key = (
            os.path.abspath(audio_path),
            os.path.getmtime(audio_path),
            self.pause_threshold,
        )
        if cache_key in self._vad_cache:
            return self._vad_cache[cache_key]

        import torch
        import torch.nn.functional as functional

        model, device = self._load_silero_model()
        waveform, sample_rate = self._load_audio_tensor(audio_path)
        waveform = waveform.to(device)
        duration = waveform.numel() / float(sample_rate) if sample_rate else 0.0
        window_size = 512 if sample_rate == 16000 else 256
        vad_threshold = _env_float("SILERO_VAD_SPEECH_THRESHOLD", 0.5)

        if hasattr(model, "reset_states"):
            model.reset_states()

        windows: list[dict[str, float]] = []
        with torch.no_grad():
            for offset in range(0, waveform.numel(), window_size):
                chunk = waveform[offset : offset + window_size]
                if chunk.numel() < window_size:
                    chunk = functional.pad(chunk, (0, window_size - chunk.numel()))
                try:
                    probability_tensor = model(chunk, sample_rate)
                except RuntimeError as exc:
                    if device != "cpu":
                        logger.warning("Silero VAD GPU inference failed: %s. Retrying on CPU.", exc)
                        self._silero_device = "cpu"
                        model.to("cpu")
                        waveform = waveform.to("cpu")
                        chunk = chunk.to("cpu")
                        probability_tensor = model(chunk, sample_rate)
                    else:
                        raise
                probability = float(probability_tensor.detach().cpu().reshape(-1)[0].item())
                window_start = offset / float(sample_rate)
                window_end = min(duration, (offset + window_size) / float(sample_rate))
                windows.append(
                    {
                        "start": _round_time(window_start),
                        "end": _round_time(window_end),
                        "probability": round(max(0.0, min(1.0, probability)), 4),
                    }
                )

        speech_ranges = self._probability_windows_to_speech_ranges(windows, vad_threshold)
        speech_map = {
            "provider": "silero_vad",
            "sampleRate": sample_rate,
            "duration": _round_time(duration),
            "windowMs": round(window_size * 1000 / sample_rate, 3),
            "speechThreshold": vad_threshold,
            "windows": windows,
            "speechRanges": speech_ranges,
        }
        self._vad_cache[cache_key] = speech_map
        return speech_map

    def _probability_windows_to_speech_ranges(
        self,
        windows: list[dict[str, float]],
        speech_threshold: float,
    ) -> list[dict[str, float]]:
        ranges: list[dict[str, float]] = []
        active_start: float | None = None
        active_end: float | None = None
        merge_gap_seconds = max(0.04, min(0.14, self.pause_threshold * 0.4))

        for window in windows:
            probability = float(window.get("probability") or 0.0)
            start = float(window["start"])
            end = float(window["end"])
            if probability >= speech_threshold:
                if active_start is None:
                    active_start = start
                    active_end = end
                elif active_end is not None and start - active_end <= merge_gap_seconds:
                    active_end = end
                else:
                    self._append_speech_range(ranges, active_start, active_end)
                    active_start = start
                    active_end = end
            elif active_start is not None and active_end is not None and start - active_end > merge_gap_seconds:
                self._append_speech_range(ranges, active_start, active_end)
                active_start = None
                active_end = None

        if active_start is not None and active_end is not None:
            self._append_speech_range(ranges, active_start, active_end)

        return ranges

    def _append_speech_range(self, ranges: list[dict[str, float]], start: float, end: float | None) -> None:
        if end is None:
            return
        if end - start < 0.04:
            return
        if ranges and start - ranges[-1]["end"] <= 0.04:
            ranges[-1]["end"] = _round_time(max(ranges[-1]["end"], end))
            ranges[-1]["duration"] = _round_time(ranges[-1]["end"] - ranges[-1]["start"])
            return
        ranges.append(
            {
                "start": _round_time(start),
                "end": _round_time(end),
                "duration": _round_time(end - start),
            }
        )

    def _speech_range_for_word(
        self,
        start: float,
        end: float,
        speech_ranges: list[dict[str, float]],
    ) -> tuple[int, dict[str, float]] | None:
        best_index: int | None = None
        best_score = 0.0
        for index, speech_range in enumerate(speech_ranges):
            range_start = float(speech_range["start"])
            range_end = float(speech_range["end"])
            if range_end < start - 0.08:
                continue
            if range_start > end + 0.08:
                break
            if range_start <= start + 0.08 and range_end >= start - 0.02:
                return index, speech_range
            overlap = min(end, range_end) - max(start, range_start)
            if overlap > best_score:
                best_score = overlap
                best_index = index

        if best_index is None or best_score <= 0.0:
            return None
        return best_index, speech_ranges[best_index]


    def _load_stable_ts_model(self) -> Any:
        model_name = os.getenv("STABLE_TS_MODEL", "base").strip() or "base"
        if self._stable_ts_model is not None and self._stable_ts_model_name == model_name:
            return self._stable_ts_model

        try:
            import stable_whisper
        except Exception:
            import stable_ts as stable_whisper

        try:
            import torch

            device = "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            device = "cpu"

        try:
            model = stable_whisper.load_model(model_name, device=device)
        except TypeError:
            model = stable_whisper.load_model(model_name)

        self._stable_ts_model = model
        self._stable_ts_model_name = model_name
        return model

    def _stable_ts_word_timestamps(self, audio_path: str, language_mode: str) -> list[dict[str, Any]]:
        model = self._load_stable_ts_model()
        language_hint = {
            "english": "en",
            "hinglish": "hi",
            "hindi": "hi",
            "telgish": "te",
            "teluglish": "te",
            "telugu": "te",
        }.get(str(language_mode).strip().lower())

        base_kwargs: dict[str, Any] = {
            "word_timestamps": True,
            "verbose": False,
        }
        if language_hint:
            base_kwargs["language"] = language_hint

        try:
            result = model.transcribe(audio_path, regroup=False, **base_kwargs)
        except TypeError:
            try:
                result = model.transcribe(audio_path, **base_kwargs)
            except TypeError:
                result = model.transcribe(audio_path)

        stable_words = self._extract_stable_ts_words(result)
        if not stable_words:
            raise RuntimeError("stable-ts did not return word timestamps.")
        return stable_words

    def _extract_stable_ts_words(self, result: Any) -> list[dict[str, Any]]:
        if hasattr(result, "to_dict"):
            payload = result.to_dict()
        elif isinstance(result, dict):
            payload = result
        else:
            payload = {
                "segments": [
                    segment.to_dict() if hasattr(segment, "to_dict") else segment
                    for segment in getattr(result, "segments", [])
                ]
            }

        extracted: list[dict[str, Any]] = []
        for segment in payload.get("segments") or []:
            segment_words = segment.get("words") if isinstance(segment, dict) else getattr(segment, "words", None)
            for raw_word in segment_words or []:
                if hasattr(raw_word, "to_dict"):
                    word_payload = raw_word.to_dict()
                elif isinstance(raw_word, dict):
                    word_payload = raw_word
                else:
                    word_payload = {
                        "word": getattr(raw_word, "word", ""),
                        "start": getattr(raw_word, "start", None),
                        "end": getattr(raw_word, "end", None),
                        "probability": getattr(raw_word, "probability", None),
                    }
                text = _word_text(word_payload)
                start = _safe_float(word_payload.get("start"))
                end = _safe_float(word_payload.get("end"))
                if not text or start is None or end is None or end <= start:
                    continue
                extracted.append(
                    {
                        "word": text,
                        "start": _round_time(start),
                        "end": _round_time(end),
                        "score": _safe_float(word_payload.get("probability"))
                        or _safe_float(word_payload.get("score"))
                        or 0.0,
                    }
                )
        return extracted

    def _apply_stable_ts_matches(
        self,
        provider_words: list[dict[str, Any]],
        stable_words: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        adjusted_words = _copy_words(provider_words)
        provider_tokens = [_normalize_token(_word_text(word)) for word in adjusted_words]
        stable_tokens = [_normalize_token(_word_text(word)) for word in stable_words]

        provider_indices = [index for index, token in enumerate(provider_tokens) if token]
        stable_indices = [index for index, token in enumerate(stable_tokens) if token]
        provider_sequence = [provider_tokens[index] for index in provider_indices]
        stable_sequence = [stable_tokens[index] for index in stable_indices]
        if not provider_sequence or not stable_sequence:
            raise RuntimeError("stable-ts match validation failed because token lists were empty.")

        matches: dict[int, int] = {}
        matcher = difflib.SequenceMatcher(a=provider_sequence, b=stable_sequence, autojunk=False)
        for tag, provider_start, provider_end, stable_start, stable_end in matcher.get_opcodes():
            if tag != "equal":
                continue
            for offset in range(provider_end - provider_start):
                matches[provider_indices[provider_start + offset]] = stable_indices[stable_start + offset]

        coverage = len(matches) / max(1, len(provider_indices))
        required_coverage = 0.5 if len(provider_indices) >= 4 else 0.67
        if coverage < required_coverage:
            logger.warning(
                "stable-ts text match coverage too low (%.2f). Trying spoken-order timing transfer.",
                coverage,
            )
            return self._apply_stable_ts_by_order(adjusted_words, stable_words)

        for provider_index, stable_index in matches.items():
            stable_word = stable_words[stable_index]
            start = _safe_float(stable_word.get("start"))
            end = _safe_float(stable_word.get("end"))
            if start is None or end is None or end <= start:
                continue
            adjusted_words[provider_index]["start"] = _round_time(start)
            adjusted_words[provider_index]["end"] = _round_time(end)
            if stable_word.get("score") is not None:
                adjusted_words[provider_index]["score"] = stable_word["score"]
            _set_timing_source(adjusted_words[provider_index], "stable_ts_adjusted")

        return adjusted_words

    def _apply_stable_ts_by_order(
        self,
        provider_words: list[dict[str, Any]],
        stable_words: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        adjusted_words = _copy_words(provider_words)
        stable_valid = [
            word
            for word in stable_words
            if _safe_float(word.get("start")) is not None
            and _safe_float(word.get("end")) is not None
            and (_safe_float(word.get("end")) or 0.0) > (_safe_float(word.get("start")) or 0.0)
        ]
        if not adjusted_words or not stable_valid:
            raise RuntimeError("stable-ts order transfer failed because word lists were empty.")

        count_ratio = len(stable_valid) / max(1, len(adjusted_words))
        if count_ratio < 0.45 or count_ratio > 2.25:
            raise RuntimeError(
                f"stable-ts order transfer rejected due to word count mismatch provider={len(adjusted_words)} stable={len(stable_valid)}."
            )

        stable_valid.sort(key=lambda word: float(word["start"]))
        boundaries: list[float] = [float(stable_valid[0]["start"])]
        for index in range(1, len(stable_valid)):
            previous_end = float(stable_valid[index - 1]["end"])
            current_start = float(stable_valid[index]["start"])
            boundaries.append((previous_end + current_start) / 2)
        boundaries.append(float(stable_valid[-1]["end"]))

        def boundary_at(position: float) -> float:
            max_index = len(boundaries) - 1
            scaled = position * max_index / max(1, len(adjusted_words))
            lower = max(0, min(max_index, int(math.floor(scaled))))
            upper = max(0, min(max_index, int(math.ceil(scaled))))
            if lower == upper:
                return boundaries[lower]
            weight = scaled - lower
            return boundaries[lower] + (boundaries[upper] - boundaries[lower]) * weight

        for index, word in enumerate(adjusted_words):
            start = boundary_at(index)
            end = boundary_at(index + 1)
            if end <= start:
                end = start + MIN_WORD_DURATION_SECONDS
            word["start"] = _round_time(start)
            word["end"] = _round_time(end)
            _set_timing_source(word, "stable_ts_order_adjusted")

        return adjusted_words


def _rescue_missing_words(input_segments: list[dict[str, Any]], aligned_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for segment_index, segment in enumerate(aligned_segments):
        source_text = ""
        if segment_index < len(input_segments):
            source = input_segments[segment_index]
            source_text = str(source.get("text") if isinstance(source, dict) else source)

        source_words = source_text.split()
        aligned_words = segment.get("words") or []
        if not source_words:
            continue

        if not aligned_words:
            start = _safe_float(segment.get("start")) or 0.0
            end = _safe_float(segment.get("end")) or start + max(0.08, len(source_words) * 0.08)
            duration = max(0.08, end - start)
            word_duration = duration / max(1, len(source_words))
            segment["words"] = [
                {
                    "word": source_word,
                    "start": _round_time(start + index * word_duration),
                    "end": _round_time(start + (index + 1) * word_duration),
                    "score": 0.5,
                    "timing_source": "low_confidence_interpolated",
                    "timingSource": "low_confidence_interpolated",
                }
                for index, source_word in enumerate(source_words)
            ]
            continue

        aligned_texts = [_normalize_token(word.get("word") or word.get("text")) for word in aligned_words]
        missing_words = [word for word in source_words if _normalize_token(word) not in aligned_texts]
        if not missing_words:
            continue

        logger.info(
            "Segment %s: rescuing %s unaligned word(s): %s",
            segment_index,
            len(missing_words),
            missing_words,
        )
        last_end = _safe_float(aligned_words[-1].get("end")) or _safe_float(segment.get("end")) or 0.0
        for missing_word in missing_words:
            aligned_words.append(
                {
                    "word": missing_word,
                    "start": _round_time(last_end),
                    "end": _round_time(last_end + 0.08),
                    "score": 0.3,
                    "timing_source": "low_confidence_interpolated",
                    "timingSource": "low_confidence_interpolated",
                }
            )
            last_end += 0.1

        segment["words"] = sorted(aligned_words, key=lambda item: _safe_float(item.get("start")) or 0.0)

    return aligned_segments


def _fallback_align_segments(tokens: list[Any]) -> list[dict[str, Any]]:
    if not tokens:
        return []

    if isinstance(tokens[0], dict):
        prompt_segments = [
            {
                "text": str(token.get("text", "")).strip(),
                "start": float(token.get("start", 0.0) or 0.0),
                "end": float(token.get("end", token.get("start", 0.0)) or 0.0),
            }
            for token in tokens
        ]
    else:
        prompt_segments = []
        cursor = 0.0
        for token in tokens:
            text = str(token).strip()
            duration = max(0.35, len(text.split()) * 0.22)
            prompt_segments.append({"text": text, "start": cursor, "end": cursor + duration})
            cursor += duration

    segments: list[dict[str, Any]] = []
    for segment in prompt_segments:
        text = str(segment["text"])
        words = text.split()
        start = float(segment["start"])
        end = max(start + 0.08, float(segment["end"]))
        duration = max(0.08, end - start)
        word_duration = duration / max(1, len(words))
        segments.append(
            {
                "text": text,
                "start": _round_time(start),
                "end": _round_time(end),
                "words": [
                    {
                        "word": word,
                        "start": _round_time(start + index * word_duration),
                        "end": _round_time(start + (index + 1) * word_duration),
                        "score": 0.45,
                        "timing_source": "interpolated_no_whisperx",
                        "timingSource": "interpolated_no_whisperx",
                    }
                    for index, word in enumerate(words)
                ],
            }
        )

    return segments


@with_retry(max_retries=RETRY_ALIGN)
def align_text(tokens: list[Any], audio_path: str, model_id: str) -> list[dict[str, Any]]:
    provider = (os.getenv("ALIGNMENT_PROVIDER", "auto") or "auto").strip().lower()
    whisperx_enabled = _env_bool("ENABLE_WHISPERX", False)
    if provider in {"none", "provider", "silero_vad_only", "stable_ts"} or (
        provider == "auto" and not whisperx_enabled
    ):
        logger.info(
            "WhisperX alignment skipped provider=%s enable_whisperx=%s. Using deterministic timing fallback.",
            provider,
            whisperx_enabled,
        )
        return _fallback_align_segments(tokens)

    try:
        import librosa
        import torch
        import whisperx

        try:
            from .alignment_models import get_alignment_model
        except ImportError:
            from alignment_models import get_alignment_model

        device = "cuda" if torch.cuda.is_available() else "cpu"
        model, metadata = get_alignment_model(model_id, device)
        duration = librosa.get_duration(filename=audio_path)

        if not tokens:
            return []

        prompt_segments: list[dict[str, Any]] = []
        if isinstance(tokens[0], dict):
            for token in tokens:
                prompt_segments.append(
                    {
                        "text": str(token.get("text", "")).strip(),
                        "start": _round_time(float(token.get("start", 0.0) or 0.0)),
                        "end": _round_time(float(token.get("end", token.get("start", 0.0)) or 0.0)),
                    }
                )
        else:
            segment_duration = duration / max(1, len(tokens))
            for index, token in enumerate(tokens):
                prompt_segments.append(
                    {
                        "text": str(token).strip(),
                        "start": _round_time(index * segment_duration),
                        "end": _round_time(min((index + 1) * segment_duration, duration)),
                    }
                )

        audio = whisperx.load_audio(audio_path)
        result = whisperx.align(prompt_segments, model, metadata, audio, device)
        aligned_segments = _rescue_missing_words(prompt_segments, result.get("segments") or [])
        for segment in aligned_segments:
            for word in segment.get("words") or []:
                if not word.get("timing_source"):
                    word["timing_source"] = "whisperx"
                if not word.get("timingSource"):
                    word["timingSource"] = word["timing_source"]
        return aligned_segments
    except Exception as exc:
        logger.warning(
            "WhisperX alignment unavailable or failed for %s with %s: %s. "
            "Using deterministic interpolated word timestamps.",
            audio_path,
            model_id,
            exc,
        )
        return _fallback_align_segments(tokens)
