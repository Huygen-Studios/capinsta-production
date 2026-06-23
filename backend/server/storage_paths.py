import re
from pathlib import Path


_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def safe_identifier(value: str, *, label: str) -> str:
    if not _SAFE_ID.fullmatch(value or ""):
        raise ValueError(f"Invalid {label}.")
    return value


def path_inside(root: Path, *parts: str) -> Path:
    resolved_root = root.resolve()
    candidate = resolved_root.joinpath(*parts).resolve()
    candidate.relative_to(resolved_root)
    return candidate
