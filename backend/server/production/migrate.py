from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path

import psycopg


MIGRATIONS = Path(os.getenv("CAPINSTA_MIGRATIONS_DIR", "/app/migrations"))


def _checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    database_url = (
        os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or ""
    ).strip()
    if not database_url:
        raise SystemExit("ADMIN_DATABASE_URL or DATABASE_URL is required")
    paths = sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    if not paths:
        raise SystemExit(f"No migrations found in {MIGRATIONS}")

    baseline = (os.getenv("CAPINSTA_MIGRATION_BASELINE") or "").strip()
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute("SELECT pg_advisory_lock(hashtext('capinsta:migrations'))")
        try:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS capinsta_schema_migrations (
                  name text PRIMARY KEY,
                  checksum text NOT NULL,
                  applied_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            applied = dict(
                connection.execute(
                    "SELECT name,checksum FROM capinsta_schema_migrations"
                ).fetchall()
            )
            if not applied and not baseline:
                raise SystemExit(
                    "CAPINSTA_MIGRATION_BASELINE is required for an existing database"
                )
            if not applied and baseline:
                for path in paths:
                    if path.name[:4] <= baseline:
                        connection.execute(
                            """
                            INSERT INTO capinsta_schema_migrations(name,checksum)
                            VALUES(%s,%s)
                            """,
                            (path.name, _checksum(path)),
                        )
                applied = dict(
                    connection.execute(
                        "SELECT name,checksum FROM capinsta_schema_migrations"
                    ).fetchall()
                )

            for path in paths:
                checksum = _checksum(path)
                if path.name in applied:
                    if applied[path.name] != checksum:
                        raise SystemExit(f"Applied migration changed: {path.name}")
                    continue
                if args.verify_only:
                    raise SystemExit(f"Migration not applied: {path.name}")
                with connection.transaction():
                    connection.execute(path.read_text(encoding="utf-8"))
                    connection.execute(
                        """
                        INSERT INTO capinsta_schema_migrations(name,checksum)
                        VALUES(%s,%s)
                        """,
                        (path.name, checksum),
                    )
                print(f"applied {path.name}")
        finally:
            connection.execute(
                "SELECT pg_advisory_unlock(hashtext('capinsta:migrations'))"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
