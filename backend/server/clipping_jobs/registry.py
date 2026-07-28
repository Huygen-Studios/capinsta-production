from __future__ import annotations

from typing import Any, Protocol

from .errors import JobOrchestrationError
from .models import JobExecutionContext, JobExecutionResult


class ProcessingJobHandler(Protocol):
    job_type: str

    def validate_input(self, payload: dict[str, Any]) -> None: ...

    def validate_output(self, payload: dict[str, Any]) -> None: ...

    async def execute(
        self, context: JobExecutionContext, payload: dict[str, Any]
    ) -> JobExecutionResult: ...


class JobHandlerRegistry:
    def __init__(self) -> None:
        self._handlers: dict[str, ProcessingJobHandler] = {}

    def register(self, handler: ProcessingJobHandler) -> None:
        if not handler.job_type:
            raise JobOrchestrationError(
                "unsupported_job_type", "Handler job type is required"
            )
        if handler.job_type in self._handlers:
            raise JobOrchestrationError(
                "handler_not_registered",
                f"A handler is already registered for {handler.job_type}",
            )
        self._handlers[handler.job_type] = handler

    def get(self, job_type: str) -> ProcessingJobHandler:
        try:
            return self._handlers[job_type]
        except KeyError as exc:
            raise JobOrchestrationError(
                "handler_not_registered",
                f"No handler is registered for {job_type}",
            ) from exc

    @property
    def supported_job_types(self) -> tuple[str, ...]:
        return tuple(sorted(self._handlers))

