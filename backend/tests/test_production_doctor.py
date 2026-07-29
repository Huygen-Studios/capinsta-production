from server.production import doctor


def test_doctor_reports_missing_database_without_secrets(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("ADMIN_DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_DSN", raising=False)
    report, ok = doctor.build_report()

    assert ok is False
    assert report["database"] == "missing_database_url"
    assert report["backendApiContractVersion"] == 1
    assert "clipping-media-uploads" in report["routeCapabilities"]
    assert "SECRET" not in str(report).upper()
