from server.api.health import readiness_payload, startup_diagnostics_payload
from server.main import app


def test_readiness_payload_is_lightweight_json_contract():
    payload = readiness_payload().model_dump()

    assert payload["status"] == "ok"
    assert payload["service"] == "capinsta-backend"
    assert payload["ready"] is True
    assert payload["readinessRoute"] == "/health/ready"
    assert payload["apiPrefix"] == "/api"


def test_readiness_routes_are_mounted_without_auth():
    paths = app.openapi()["paths"]

    assert "get" in paths["/health/ready"]
    assert "get" in paths["/api/health/ready"]
    assert "get" in paths["/api/v1/health/ready"]
    assert "post" in paths["/api/v1/jobs"]
    assert "get" in paths["/api/v1/export/jobs/{export_job_id}"]


def test_startup_diagnostics_reports_catalog_counts():
    payload = startup_diagnostics_payload()

    assert payload["status"] == "ok"
    assert payload["apiPrefix"] == "/api"
    assert payload["readinessRoute"] == "/health/ready"
    assert payload["providerCatalogCount"] >= 1
    assert "sarvam:saaras:v3" in payload["providerModels"]
    assert payload["presetCatalogCount"] >= 1
    assert payload["startupHeavyChecks"]["silero"] == "deferred_to_health_timing"
