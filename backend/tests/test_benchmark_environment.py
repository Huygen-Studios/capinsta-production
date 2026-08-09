from pathlib import Path

import pytest

from server.benchmark_environment import (
    assert_safe_benchmark_environment,
    configure_disposable_benchmark_environment,
)


def test_benchmark_environment_fails_closed_and_accepts_disposable_paths(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="CAPINSTA_ENV"):
        assert_safe_benchmark_environment({})
    unsafe = {"CAPINSTA_ENV": "benchmark", "DATABASE_URL": "postgresql://production.example/db"}
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        configure_disposable_benchmark_environment(tmp_path, unsafe)
    safe = {"CAPINSTA_ENV": "benchmark"}
    configure_disposable_benchmark_environment(tmp_path, safe)
    assert assert_safe_benchmark_environment(safe) == tmp_path.resolve()
