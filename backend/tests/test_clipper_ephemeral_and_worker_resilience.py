from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest

from server.clipping_jobs.config import ProcessingWorkerConfig
from server.clipping_jobs.errors import JobOrchestrationError
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_jobs.worker import ProcessingWorker
from server.clipping_persistence.models import AuthenticatedActor


def _run(coro):
    return asyncio.run(coro)


class DummyHandler:
    def __init__(self, job_type: str) -> None:
        self.job_type = job_type

    def validate_input(self, payload: dict) -> None:
        pass

    def validate_output(self, payload: dict) -> None:
        pass

    async def execute(self, context: any, payload: dict) -> any:
        pass


class FakeRepository:
    def __init__(self):
        self.heartbeats = []

    async def claim_next_job(self, **kwargs):
        return None

    async def upsert_worker_heartbeat(self, **kwargs):
        self.heartbeats.append(kwargs)

    async def get_worker_capabilities(self):
        supported_all = set()
        for h in self.heartbeats:
            for j in h.get("supported_job_types", ()):
                supported_all.add(j)
        return {
            "media_worker_available": "media_probe" in supported_all,
            "ai_worker_available": "transcription" in supported_all,
            "runtime_worker_available": "project_derivation" in supported_all,
            "export_worker_available": "clip_export" in supported_all,
            "supported_job_types": sorted(list(supported_all)),
        }


def test_worker_required_handlers_validation():
    async def _test():
        config = ProcessingWorkerConfig(
            enabled=True,
            worker_id="test-media",
            required_job_types=("media_probe", "proxy_generation", "audio_extraction"),
        )
        registry = JobHandlerRegistry()
        registry.register(DummyHandler("media_probe"))
        # Missing proxy_generation and audio_extraction

        repo = FakeRepository()
        worker = ProcessingWorker(config=config, repository=repo, registry=registry)

        with pytest.raises(JobOrchestrationError) as exc:
            await worker.run_forever()
        assert exc.value.category == "required_handler_missing"

    _run(_test())


def test_worker_heartbeat_upsert():
    async def _test():
        repo = FakeRepository()
        worker_id = f"test-worker-{uuid4().hex[:6]}"

        await repo.upsert_worker_heartbeat(
            worker_id=worker_id,
            role="media",
            supported_job_types=("media_probe", "audio_extraction"),
            build_sha="test-sha",
            status="active",
        )

        caps = await repo.get_worker_capabilities()
        assert caps["media_worker_available"] is True
        assert "media_probe" in caps["supported_job_types"]

    _run(_test())


def test_authenticated_actor_identity():
    user_id = str(uuid4())
    actor = AuthenticatedActor.from_verified_user(user_id)
    assert str(actor.user_id) == user_id
