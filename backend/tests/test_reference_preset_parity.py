from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


CURRENT_ROOT = Path(__file__).resolve().parents[2]
REFERENCE_ROOT = Path(r"G:\Huygen Studios\side projects\stable versions\Huygen-Caps-main-v4\capinsta-production-main")

RESOLVE_SCRIPT = r"""
import json
from ai_pipeline.timing_presets import TIMING_PRESETS
from ai_pipeline.pipeline_config import resolve_pipeline_config
print(json.dumps({
    preset.id: resolve_pipeline_config(preset.pipeline_options).to_dict()
    for preset in TIMING_PRESETS
}, sort_keys=True))
"""


def _resolve(root: Path, extra_env: dict[str, str] | None = None) -> dict[str, Any]:
    env = os.environ.copy()
    for key in (
        "STABLE_TS_MAX_AUDIO_SECONDS",
        "MAXIMUM_ESTIMATED_WORD_RATIO",
        "MAXIMUM_DETERMINISTIC_FALLBACK_RATIO",
        "MINIMUM_REAL_TIMED_WORD_COVERAGE",
        "CAPINSTA_MODEL_CACHE_DIR",
        "XDG_CACHE_HOME",
        "HF_HOME",
    ):
        env.pop(key, None)
    env["PYTHONPATH"] = str(root / "backend")
    if extra_env:
        env.update(extra_env)
    result = subprocess.run(
        [sys.executable, "-c", RESOLVE_SCRIPT],
        cwd=str(root),
        env=env,
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(result.stdout)


def _field_mismatches(reference: Any, current: Any, path: str = "") -> list[dict[str, Any]]:
    if isinstance(reference, dict) and isinstance(current, dict):
        mismatches: list[dict[str, Any]] = []
        for key in sorted(set(reference) | set(current)):
            if key in {"stableTsFallbackEnabled", "whisperxFallbackEnabled", "sarvamMaxConcurrency", "preset"}:
                continue
            next_path = f"{path}.{key}" if path else str(key)
            if key not in reference or key not in current:
                mismatches.append(
                    {
                        "path": next_path,
                        "reference": reference.get(key),
                        "current": current.get(key),
                    }
                )
                continue
            mismatches.extend(_field_mismatches(reference[key], current[key], next_path))
        return mismatches
    if reference != current:
        return [{"path": path, "reference": reference, "current": current}]
    return []


def test_current_resolved_presets_match_reference_field_by_field():
    reference = _resolve(REFERENCE_ROOT)
    current = _resolve(CURRENT_ROOT)
    failures: list[dict[str, Any]] = []
    for preset_id, reference_config in reference.items():
        for mismatch in _field_mismatches(reference_config, current.get(preset_id), preset_id):
            mismatch["owner"] = "backend/ai_pipeline/timing_presets.py -> backend/ai_pipeline/pipeline_config.py"
            failures.append(mismatch)
    assert failures == []


def test_runtime_only_environment_does_not_change_caption_resolution():
    baseline = _resolve(CURRENT_ROOT)
    with_runtime_env = _resolve(
        CURRENT_ROOT,
        {
            "CAPINSTA_MODEL_CACHE_DIR": "/tmp/capinsta-model-cache",
            "XDG_CACHE_HOME": "/tmp/capinsta-xdg",
            "HF_HOME": "/tmp/capinsta-hf",
        },
    )
    assert with_runtime_env == baseline


def test_legacy_caption_tuning_environment_is_ignored_for_new_resolution():
    baseline = _resolve(CURRENT_ROOT)
    with_legacy_env = _resolve(
        CURRENT_ROOT,
        {
            "STABLE_TS_MAX_AUDIO_SECONDS": "999",
            "MAXIMUM_ESTIMATED_WORD_RATIO": "0.01",
            "MAXIMUM_DETERMINISTIC_FALLBACK_RATIO": "0.01",
            "MINIMUM_REAL_TIMED_WORD_COVERAGE": "0.99",
        },
    )
    assert with_legacy_env == baseline
