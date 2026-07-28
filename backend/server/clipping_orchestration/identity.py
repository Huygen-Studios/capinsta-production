from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
        ).encode("utf-8")
    ).hexdigest()


def stable_id(prefix: str, value: Any, length: int = 32) -> str:
    return f"{prefix}_{canonical_hash(value)[:length]}"


def validate_idempotency_key(value: str) -> str:
    if (
        not value
        or len(value) > 128
        or any(not (character.isalnum() or character in "._:-") for character in value)
    ):
        raise ValueError("invalid idempotency key")
    return value
