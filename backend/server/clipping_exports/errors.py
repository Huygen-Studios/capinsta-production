from __future__ import annotations


class ClippingExportError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 422) -> None:
        self.code = code
        self.safe_message = message
        self.status_code = status_code
        super().__init__(message)
