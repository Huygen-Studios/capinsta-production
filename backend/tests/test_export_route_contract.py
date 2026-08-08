from server.api.export_jobs import ExportJobStatus
from server.main import app


def test_background_export_router_is_mounted_under_api_prefix():
    paths = app.openapi()["paths"]

    assert "post" in paths["/api/export/jobs"]
    assert "get" in paths["/api/export/jobs/{export_job_id}"]
    assert "get" in paths["/api/export/jobs/{export_job_id}/download"]


def test_failed_export_status_exposes_stage_and_correlation_id():
    payload = ExportJobStatus(
        id="export-1",
        source_job_id="caption-1",
        status="failed",
        stage="playwright",
        progress=-1,
        error="Browser process exited.",
        user_id="user-1",
        correlation_id="corr-1",
    ).to_public_dict()

    assert payload["status"] == "failed"
    assert payload["stage"] == "playwright"
    assert payload["error"] == "Browser process exited."
    assert payload["correlationId"] == "corr-1"


def test_completed_export_status_exposes_download_url():
    payload = ExportJobStatus(
        id="export-2",
        source_job_id="caption-1",
        status="completed",
        stage="completed",
        progress=100,
        download_url="/api/export/jobs/export-2/download",
        filename="capinsta-export-2.mp4",
        user_id="user-1",
    ).to_public_dict()

    assert payload["downloadUrl"] == (
        "/api/export/jobs/export-2/download"
    )
    assert payload["filename"].endswith(".mp4")
