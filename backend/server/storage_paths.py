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


def resolve_existing_file_inside(root: Path, raw_path: str | Path, *, label: str) -> Path:
    if "\x00" in str(raw_path):
        raise ValueError(f"Invalid {label}.")
    resolved_root = root.resolve()
    candidate = Path(raw_path).resolve()
    candidate.relative_to(resolved_root)
    if not candidate.is_file():
        raise FileNotFoundError(f"{label} was not found.")
    return candidate


def public_download_name(value: str | None, *, fallback: str) -> str:
    raw = Path(value or fallback).name
    sanitized = re.sub(r"[^A-Za-z0-9._ -]+", "_", raw).strip(" ._")
    return sanitized or fallback
