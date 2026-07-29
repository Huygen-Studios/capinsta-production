from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

try:
    import psycopg
except Exception:  # pragma: no cover - optional production dependency
    psycopg = None

from server.api.health import API_CAPABILITIES, API_CONTRACT_VERSION

EXPECTED_MIGRATION = 26
BUCKETS = ("source-media", "media-variants", "media-exports")


def _database_url() -> str:
    return (
        os.getenv("ADMIN_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or os.getenv("POSTGRES_DSN")
        or ""
    ).strip()


def _check_env() -> dict[str, Any]:
    return {
        "backendApiContractVersion": API_CONTRACT_VERSION,
        "routeCapabilities": API_CAPABILITIES,
        "uploadAdmission": "disabled" if os.getenv("DISABLE_NEW_UPLOADS") else "enabled",
        "candidateAdmission": "disabled"
        if os.getenv("DISABLE_CANDIDATE_ANALYSIS")
        else "enabled",
        "exportAdmission": "disabled"
        if os.getenv("DISABLE_CLIPPING_EXPORTS")
        else "enabled",
        "transcriptionProvider": "configured"
        if (
            os.getenv("SARVAM_API_KEY")
            or os.getenv("OPENAI_API_KEY")
            or os.getenv("ASSEMBLYAI_API_KEY")
        )
        else "not_configured",
        "candidateProvider": "deterministic_fallback_available",
    }


def _query_one(connection: Any, query: str, params: tuple[Any, ...] = ()) -> Any:
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        return cursor.fetchone()


def _db_report() -> tuple[dict[str, Any], bool]:
    url = _database_url()
    if not url:
        return {"database": "missing_database_url"}, False
    if psycopg is None:
        return {"database": "psycopg_not_installed"}, False

    try:
        with psycopg.connect(url, connect_timeout=5) as connection:
            migration_table = bool(
                _query_one(
                    connection,
                    "SELECT to_regclass('public.capinsta_schema_migrations') IS NOT NULL",
                )[0]
            )
            latest_name = None
            if migration_table:
                row = _query_one(
                    connection,
                    "SELECT name FROM capinsta_schema_migrations ORDER BY name DESC LIMIT 1",
                )
                latest_name = row[0] if row else None
            latest_version = (
                int(str(latest_name).split("_", 1)[0])
                if latest_name and str(latest_name)[:4].isdigit()
                else 0
            )
            bucket_rows = _query_one(
                connection,
                """
                SELECT COALESCE(jsonb_object_agg(id, public), '{}'::jsonb)
                FROM storage.buckets WHERE id = ANY(%s)
                """,
                (list(BUCKETS),),
            )
            buckets = dict(bucket_rows[0] or {})
            mode_row = _query_one(
                connection,
                "SELECT mode FROM site_access_policy WHERE id='global'",
            )
            report = {
                "database": "reachable",
                "migrationLedger": "present" if migration_table else "missing",
                "latestMigration": latest_name,
                "expectedLatestMigrationVersion": EXPECTED_MIGRATION,
                "storageBuckets": {
                    name: {
                        "exists": name in buckets,
                        "private": buckets.get(name) is False,
                    }
                    for name in BUCKETS
                },
                "siteAccessMode": mode_row[0] if mode_row else "public",
            }
            ok = (
                migration_table
                and latest_version >= EXPECTED_MIGRATION
                and all(
                    bucket.get("exists") and bucket.get("private")
                    for bucket in report["storageBuckets"].values()
                )
            )
            return report, ok
    except Exception as error:
        return {"database": "unreachable", "errorType": type(error).__name__}, False


def build_report() -> tuple[dict[str, Any], bool]:
    db, db_ok = _db_report()
    report = {"status": "ok" if db_ok else "missing_setup", **_check_env(), **db}
    return report, db_ok


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only Capinsta production doctor.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()
    report, ok = build_report()
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        for key, value in report.items():
            print(f"{key}: {value}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
