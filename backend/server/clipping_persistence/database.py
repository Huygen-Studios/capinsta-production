from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from .errors import PersistenceError

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - production requirements install psycopg
    psycopg = None
    dict_row = None


def durable_jobs_enabled() -> bool:
    return os.getenv("ENABLE_SUPABASE_DURABLE_JOBS", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _database_url() -> str:
    return (
        os.getenv("ADMIN_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or ""
    ).strip()


class DurableDatabase:
    """Small direct-Postgres boundary used for transactional trusted writes."""

    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = (database_url or _database_url()).strip()

    @asynccontextmanager
    async def connection(self):
        if psycopg is None or not self.database_url:
            raise PersistenceError(
                "database_unavailable",
                "Durable clipping database is not configured",
            )
        try:
            async with await psycopg.AsyncConnection.connect(
                self.database_url,
                row_factory=dict_row,
                connect_timeout=5,
            ) as connection:
                yield connection
        except PersistenceError:
            raise
        except Exception as exc:
            # Business/domain errors raised while a caller uses the connection
            # are not database failures and must retain their public category.
            if not isinstance(exc, psycopg.Error):
                raise
            raise PersistenceError(
                "database_unavailable",
                "Durable clipping database operation failed",
            ) from exc

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[object]:
        async with self.connection() as connection:
            try:
                async with connection.transaction():
                    yield connection
            except PersistenceError:
                raise
            except Exception as exc:
                # Translate only driver/database failures. Repository domain
                # errors must pass through the transaction unchanged.
                if not isinstance(exc, psycopg.Error):
                    raise
                category = {
                    "23505": "duplicate_entity",
                    "23503": "foreign_key_missing",
                    "42501": "rls_policy_denied",
                }.get(getattr(exc, "sqlstate", None), "transaction_failed")
                raise PersistenceError(
                    category,
                    "Durable clipping transaction failed",
                ) from exc
