from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, Request

DEFAULT_PAGE_LIMIT = 25
MAX_PAGE_LIMIT = 100


@dataclass(frozen=True)
class CursorPage:
    limit: int
    cursor_created_at: str | None = None
    cursor_id: str | None = None


def _secret() -> bytes:
    return (
        os.getenv("PAGINATION_CURSOR_SECRET")
        or os.getenv("INTERNAL_MAINTENANCE_SECRET")
        or os.getenv("SUPABASE_JWT_SECRET")
        or "capinsta-development-pagination"
    ).encode("utf-8")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _sign(payload: str) -> str:
    return _b64(hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).digest())


def encode_cursor(*, created_at: str, item_id: str) -> str:
    payload = _b64(json.dumps({"created_at": created_at, "id": item_id}, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    return f"{payload}.{_sign(payload)}"


def decode_cursor(cursor: str | None) -> tuple[str | None, str | None]:
    if not cursor:
        return None, None
    payload, separator, signature = cursor.partition(".")
    if not separator or not hmac.compare_digest(_sign(payload), signature):
        raise HTTPException(status_code=400, detail={"code": "invalid_cursor", "message": "Pagination cursor is invalid."})
    try:
        decoded: Any = json.loads(_unb64(payload).decode("utf-8"))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail={"code": "invalid_cursor", "message": "Pagination cursor is invalid."}) from exc
    created_at = decoded.get("created_at") if isinstance(decoded, dict) else None
    item_id = decoded.get("id") if isinstance(decoded, dict) else None
    if not isinstance(created_at, str) or not created_at or not isinstance(item_id, str) or not item_id:
        raise HTTPException(status_code=400, detail={"code": "invalid_cursor", "message": "Pagination cursor is invalid."})
    return created_at, item_id


def parse_cursor_page(*, limit: int | None, cursor: str | None) -> CursorPage:
    resolved_limit = DEFAULT_PAGE_LIMIT if limit is None else limit
    if resolved_limit < 1 or resolved_limit > MAX_PAGE_LIMIT:
        raise HTTPException(status_code=400, detail={"code": "invalid_page_limit", "message": f"Limit must be between 1 and {MAX_PAGE_LIMIT}."})
    created_at, item_id = decode_cursor(cursor)
    return CursorPage(limit=resolved_limit, cursor_created_at=created_at, cursor_id=item_id)


def should_return_paginated_response(request: Request) -> bool:
    return request.url.path.startswith("/api/v1/") or "cursor" in request.query_params or "limit" in request.query_params


def pagination_payload(*, items: list[dict[str, Any]], rows: list[Any], limit: int) -> dict[str, Any]:
    has_more = len(rows) > limit
    visible_rows = rows[:limit]
    visible_items = items[:limit]
    next_cursor = None
    if has_more and visible_rows:
        last = visible_rows[-1]
        next_cursor = encode_cursor(created_at=str(last["created_at"]), item_id=str(last["id"]))
    return {
        "items": visible_items,
        "pagination": {
            "limit": limit,
            "hasMore": has_more,
            "nextCursor": next_cursor,
        },
    }
