"""Durable Supabase/Postgres persistence boundary for clipping records.

The existing SQLite caption/export runtime remains authoritative unless
ENABLE_SUPABASE_DURABLE_JOBS is explicitly enabled.
"""

from .database import DurableDatabase, durable_jobs_enabled
from .errors import PersistenceError
from .models import AuthenticatedActor
from .repositories import (
    ClipProjectRepository,
    IdempotencyRepository,
    MediaAssetRepository,
    ProcessingJobRepository,
    TranscriptRepository,
)

__all__ = [
    "AuthenticatedActor",
    "ClipProjectRepository",
    "DurableDatabase",
    "IdempotencyRepository",
    "MediaAssetRepository",
    "PersistenceError",
    "ProcessingJobRepository",
    "TranscriptRepository",
    "durable_jobs_enabled",
]
