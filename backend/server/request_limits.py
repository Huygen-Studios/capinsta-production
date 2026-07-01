from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from .settings import MAX_FORM_BODY_BYTES, MAX_JSON_BODY_BYTES, MAX_UPLOAD_SIZE_MB

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
UPLOAD_BODY_OVERHEAD_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True)
class BodyLimitDecision:
    allowed: bool
    limit: int | None = None
    received: int | None = None
    reason: str | None = None


def _content_length(request: Request) -> int | None:
    raw = request.headers.get("content-length")
    if raw is None:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value >= 0 else None


def _body_limit_for_content_type(content_type: str) -> int | None:
    lower = content_type.split(";", 1)[0].strip().lower()
    if not lower:
        return MAX_JSON_BODY_BYTES
    if lower == "application/json" or lower.endswith("+json"):
        return MAX_JSON_BODY_BYTES
    if lower == "application/x-www-form-urlencoded":
        return MAX_FORM_BODY_BYTES
    if lower == "multipart/form-data":
        return MAX_UPLOAD_SIZE_MB * 1024 * 1024 + UPLOAD_BODY_OVERHEAD_BYTES
    return MAX_JSON_BODY_BYTES


def evaluate_request_body_limit(request: Request) -> BodyLimitDecision:
    if request.method.upper() not in UNSAFE_METHODS:
        return BodyLimitDecision(allowed=True)

    received = _content_length(request)
    if received is None:
        return BodyLimitDecision(allowed=True)

    limit = _body_limit_for_content_type(request.headers.get("content-type", ""))
    if limit is None or received <= limit:
        return BodyLimitDecision(allowed=True, limit=limit, received=received)

    return BodyLimitDecision(
        allowed=False,
        limit=limit,
        received=received,
        reason="request_body_too_large",
    )
