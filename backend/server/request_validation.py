from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


class UnsafeJsonPayload(ValueError):
    pass


def validate_client_json_object(
    value: Any,
    *,
    label: str = "payload",
    max_depth: int = 12,
    max_keys: int = 500,
    max_array_items: int = 1000,
    max_string_length: int = 10000,
) -> Any:
    seen_keys = 0

    def walk(node: Any, path: str, depth: int) -> None:
        nonlocal seen_keys
        if depth > max_depth:
            raise UnsafeJsonPayload(f"{label} is too deeply nested")
        if isinstance(node, Mapping):
            seen_keys += len(node)
            if seen_keys > max_keys:
                raise UnsafeJsonPayload(f"{label} has too many keys")
            for key, child in node.items():
                if not isinstance(key, str):
                    raise UnsafeJsonPayload(f"{label} contains a non-string key")
                if key.startswith("$") or "." in key:
                    raise UnsafeJsonPayload(f"{label} contains an unsafe key")
                walk(child, f"{path}.{key}" if path else key, depth + 1)
            return
        if isinstance(node, str):
            if len(node) > max_string_length:
                raise UnsafeJsonPayload(f"{label} contains an oversized string")
            return
        if isinstance(node, Sequence) and not isinstance(node, (str, bytes, bytearray)):
            if len(node) > max_array_items:
                raise UnsafeJsonPayload(f"{label} contains too many array items")
            for index, child in enumerate(node):
                walk(child, f"{path}[{index}]", depth + 1)

    walk(value, "", 0)
    return value
