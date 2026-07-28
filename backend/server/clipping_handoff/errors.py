from __future__ import annotations

from dataclasses import dataclass


@dataclass
class HandoffError(Exception):
    code: str
    safe_message: str
    status_code: int

    def __post_init__(self) -> None:
        Exception.__init__(self, self.safe_message)

