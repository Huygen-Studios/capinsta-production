from __future__ import annotations

import os
from pathlib import Path
from typing import MutableMapping


EXTERNAL_ENV_KEYS = (
    "ADMIN_DATABASE_URL", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_JWT_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "R2_ACCOUNT_ID",
    "R2_ENDPOINT", "R2_ENDPOINT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_ENDPOINT",
)
PATH_ENV_KEYS = ("TEMP_DIR", "UPLOAD_DIR", "EXPORT_DIR", "CACHE_DIR", "MEDIA_DIR", "DB_PATH")
OVERRIDE = "I_UNDERSTAND_THIS_CAN_MUTATE_EXTERNAL_SYSTEMS"


def assert_safe_benchmark_environment(environ: MutableMapping[str, str] | None = None) -> Path:
    env = environ if environ is not None else os.environ
    if env.get("CAPINSTA_ENV", "").strip().lower() != "benchmark":
        raise RuntimeError("BENCHMARK_ENV_UNSAFE: CAPINSTA_ENV=benchmark is required")
    configured = sorted(key for key in EXTERNAL_ENV_KEYS if env.get(key, "").strip())
    if configured and env.get("CAPINSTA_BENCHMARK_ALLOW_EXTERNAL_MUTATION") != OVERRIDE:
        raise RuntimeError(f"BENCHMARK_ENV_UNSAFE: external configuration is set: {', '.join(configured)}")
    root_value = env.get("CAPINSTA_BENCHMARK_ROOT", "").strip()
    if not root_value:
        raise RuntimeError("BENCHMARK_ENV_UNSAFE: CAPINSTA_BENCHMARK_ROOT is required")
    root = Path(root_value).resolve()
    for key in PATH_ENV_KEYS:
        value = env.get(key, "").strip()
        if not value or not Path(value).resolve().is_relative_to(root):
            raise RuntimeError(f"BENCHMARK_ENV_UNSAFE: {key} must be inside CAPINSTA_BENCHMARK_ROOT")
    return root


def configure_disposable_benchmark_environment(root: Path, environ: MutableMapping[str, str] | None = None) -> None:
    env = environ if environ is not None else os.environ
    if env.get("CAPINSTA_ENV", "").strip().lower() != "benchmark":
        raise RuntimeError("BENCHMARK_ENV_UNSAFE: CAPINSTA_ENV=benchmark must be set explicitly")
    resolved = root.resolve()
    env["CAPINSTA_BENCHMARK_ROOT"] = str(resolved)
    env.update({
        "TEMP_DIR": str(resolved),
        "UPLOAD_DIR": str(resolved / "uploads"),
        "EXPORT_DIR": str(resolved / "exports"),
        "CACHE_DIR": str(resolved / "cache"),
        "MEDIA_DIR": str(resolved / "media"),
        "DB_PATH": str(resolved / "benchmark.sqlite"),
        "ENABLE_SUPABASE_DURABLE_JOBS": "false",
        "ENABLE_SUPABASE_MEDIA_STORAGE": "false",
    })
    assert_safe_benchmark_environment(env)
