from __future__ import annotations

import json
import asyncio

import pytest

from server.headless_export import (
    ExportStageError,
    _checkpoint_renderer_refresh_required,
    _looks_like_browser_disconnect,
    _wait_for_renderer_ready_state,
)


class FakeRenderPage:
    def __init__(self, state):
        self.state = state
        self.predicates: list[str] = []
        self.url = "https://capinsta.example.com/render?render_token=super-secret"

    async def wait_for_function(self, predicate: str, timeout: int):
        self.predicates.append(predicate)

    async def evaluate(self, script: str):
        if "__CAPINSTA_RENDER_STATE__" in script:
            return self.state
        if "document.body" in script:
            return "body without caption text"
        return None

    async def screenshot(self, *, path: str, full_page: bool):
        with open(path, "wb") as handle:
            handle.write(b"fake-png")

    async def title(self):
        return "Renderer"


class TimedOutRenderPage(FakeRenderPage):
    async def wait_for_function(self, predicate: str, timeout: int):
        self.predicates.append(predicate)
        raise TimeoutError(
            f"Page.wait_for_function: Timeout {timeout}ms exceeded."
        )


def test_renderer_ready_wait_uses_structured_state_only():
    page = FakeRenderPage({"version": 1, "status": "ready", "error": None, "diagnostics": {}})

    state = asyncio.run(
        _wait_for_renderer_ready_state(
            page=page,
            timeout_ms=1000,
            export_job_id="export-ready",
            page_logs=[],
            redirect_chain=[],
        )
    )

    assert state["status"] == "ready"
    assert len(page.predicates) == 1
    assert "__CAPINSTA_RENDER_STATE__" in page.predicates[0]
    assert "__CAPINSTA_RENDER_READY__" not in page.predicates[0]
    assert "__RENDER_PAGE_LOADED__" not in page.predicates[0]


def test_renderer_error_state_returns_structured_diagnostics():
    page = FakeRenderPage(
        {
            "version": 1,
            "status": "error",
            "error": {"code": "render_token_invalid", "message": "Render token is invalid"},
            "diagnostics": {"compositionLoaded": False},
        }
    )

    with pytest.raises(ExportStageError) as exc:
        asyncio.run(
            _wait_for_renderer_ready_state(
                page=page,
                timeout_ms=1000,
                export_job_id="export-error",
                page_logs=["pageerror: Error: boom", "requestfailed: https://example.com/media?token=[redacted]"],
                redirect_chain=["https://capinsta.example.com/render"],
            )
        )

    message = str(exc.value)
    assert exc.value.stage == "renderer_ready"
    assert "render_token_invalid" in message
    assert "super-secret" not in message
    assert "Diagnostics:" in message
    diagnostics = json.loads(message.split("Diagnostics: ", 1)[1])
    assert diagnostics["reason"] == "renderer_error_state"
    assert diagnostics["renderState"]["status"] == "error"
    assert diagnostics["screenshotPath"]


def test_renderer_timeout_is_recoverable_and_has_structured_diagnostics():
    page = TimedOutRenderPage(
        {
            "version": 1,
            "status": "booting",
            "error": None,
            "diagnostics": {"firstLayoutComplete": False},
        }
    )

    with pytest.raises(ExportStageError) as caught:
        asyncio.run(
            _wait_for_renderer_ready_state(
                page=page,
                timeout_ms=120000,
                export_job_id="export-timeout",
                page_logs=[],
                redirect_chain=[],
            )
        )

    assert caught.value.stage == "renderer_ready"
    assert "render_state_never_ready" in str(caught.value)
    assert _looks_like_browser_disconnect(caught.value) is True


def test_checkpoint_renderer_reuses_page_when_recycling_is_disabled():
    assert (
        _checkpoint_renderer_refresh_required(
            page_available=True,
            capture_frame=93600,
            last_refresh_frame=0,
            recycle_frames=0,
        )
        is False
    )
    assert (
        _checkpoint_renderer_refresh_required(
            page_available=False,
            capture_frame=93600,
            last_refresh_frame=0,
            recycle_frames=0,
        )
        is True
    )


def test_checkpoint_renderer_honors_explicit_recycle_interval():
    assert (
        _checkpoint_renderer_refresh_required(
            page_available=True,
            capture_frame=2999,
            last_refresh_frame=0,
            recycle_frames=3000,
        )
        is False
    )
    assert (
        _checkpoint_renderer_refresh_required(
            page_available=True,
            capture_frame=3000,
            last_refresh_frame=0,
            recycle_frames=3000,
        )
        is True
    )
