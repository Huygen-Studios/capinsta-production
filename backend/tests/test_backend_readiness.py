import asyncio

from server.api.health import readiness_payload, startup_diagnostics_payload
from server.main import app


def test_readiness_payload_is_lightweight_json_contract(monkeypatch):
    async def healthy():
        return {"controlPlaneDatabase": "healthy"}

    monkeypatch.setattr("server.api.health.control_plane_health", healthy)
    payload = asyncio.run(readiness_payload()).model_dump()

    assert payload["status"] == "ok"
    assert payload["service"] == "capinsta-backend"
    assert payload["ready"] is True
    assert payload["readinessRoute"] == "/health/ready"
    assert payload["apiPrefix"] == "/api"
    assert payload["apiContractVersion"] == 1
    assert "clipping-media-uploads" in payload["capabilities"]
    assert payload["latestExpectedMigrationVersion"] >= 26


def test_readiness_routes_are_mounted_without_auth():
    paths = app.openapi()["paths"]

    assert "get" in paths["/health/ready"]
    assert "get" in paths["/api/health/ready"]
    assert "get" in paths["/api/v1/health/ready"]
    assert "post" in paths["/api/v1/jobs"]
    assert "get" in paths["/api/v1/export/jobs/{export_job_id}"]
    for prefix in ("/api", "/api/v1"):
        assert "post" in paths[f"{prefix}/jobs"]
        assert "get" in paths[f"{prefix}/jobs/{{job_id}}"]
        assert "post" in paths[f"{prefix}/clipping/media/uploads"]
        assert "post" in paths[f"{prefix}/clipping/media/uploads/{{upload_session_id}}/complete"]
        assert "post" in paths[f"{prefix}/clipping/workflows/{{media_asset_id}}/advance"]
        assert "get" in paths[f"{prefix}/clipping/projects/{{project_id}}/candidates"]
        assert "post" in paths[f"{prefix}/clipping/projects/{{project_id}}/exports"]
        assert "post" in paths[f"{prefix}/capinsta/media/{{media_asset_id}}/access"]


def test_startup_diagnostics_reports_catalog_counts():
    payload = startup_diagnostics_payload()

    assert payload["status"] == "ok"
    assert payload["apiPrefix"] == "/api"
    assert payload["readinessRoute"] == "/health/ready"
    assert payload["providerCatalogCount"] >= 1
    assert "sarvam:saaras:v3" in payload["providerModels"]
    assert payload["presetCatalogCount"] >= 1
    assert payload["startupHeavyChecks"]["silero"] == "deferred_to_health_timing"
