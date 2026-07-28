from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class OrchestrationError(Exception):
    code: str
    message: str
    status_code: int
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        Exception.__init__(self, self.message)
