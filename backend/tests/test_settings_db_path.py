from server import settings


def test_unwritable_sqlite_path_falls_back_to_temp(monkeypatch, tmp_path):
    bad_path = tmp_path / "database.sqlite"
    bad_path.mkdir()
    fallback_root = tmp_path / "fallback"

    monkeypatch.setenv("DB_PATH", str(bad_path))
    monkeypatch.setattr(settings, "DEFAULT_TEMP_DIR", fallback_root)

    assert settings._sqlite_path_env("DB_PATH", tmp_path / "unused.sqlite") == (
        fallback_root / "database.sqlite"
    )


def test_production_unwritable_sqlite_path_fails_clearly(monkeypatch, tmp_path):
    bad_path = tmp_path / "database.sqlite"
    bad_path.mkdir()

    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("DB_PATH", str(bad_path))

    try:
        settings._sqlite_path_env("DB_PATH", tmp_path / "unused.sqlite")
    except RuntimeError as error:
        assert "legacy caption storage volume" in str(error)
    else:
        raise AssertionError("production DB_PATH must not fall back to /tmp")
