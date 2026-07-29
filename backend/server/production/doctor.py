from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from typing import Any

try:
    import psycopg
except Exception:  # pragma: no cover - optional production dependency
    psycopg = None

from server.api.health import API_CAPABILITIES, API_CONTRACT_VERSION
from server.clipping_storage.config import MediaStorageConfig
from server.settings import (
    CACHE_DIR,
    DB_PATH,
    DISK_REJECT_UPLOAD_FREE_BYTES,
    EXPORT_DIR,
    MEDIA_DIR,
    TEMP_DIR,
    UPLOAD_DIR,
    validate_storage_startup,
)

EXPECTED_MIGRATION = 28
BUCKETS = ("source-media", "media-variants", "media-exports")


def _database_url() -> str:
    return (
        os.getenv("ADMIN_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or os.getenv("POSTGRES_DSN")
        or ""
    ).strip()


def _check_env() -> dict[str, Any]:
    storage = MediaStorageConfig.from_env()
    return {
        "backendApiContractVersion": API_CONTRACT_VERSION,
        "routeCapabilities": API_CAPABILITIES,
        "mediaStorageProvider": storage.storage_provider,
        "r2Storage": {
            "configured": storage.storage_provider == "r2",
            "endpointConfigured": bool(storage.r2_endpoint_url),
            "sourceBucket": storage.r2_source_bucket,
            "variantsBucket": storage.r2_variants_bucket,
            "exportsBucket": storage.r2_exports_bucket,
            "partSizeBytes": storage.r2_part_size_bytes,
            "signedUrlTtlSeconds": storage.r2_signed_url_ttl_seconds,
            "uploadConcurrency": storage.r2_upload_concurrency,
        },
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


def _legacy_caption_report() -> tuple[dict[str, Any], bool]:
    findings = validate_storage_startup()
    failed = [item for item in findings if item.get("level") == "error"]
    sqlite_ok = False
    try:
        with sqlite3.connect(f"file:{DB_PATH}?mode=rw", uri=True, timeout=5) as db:
            db.execute("PRAGMA busy_timeout = 5000")
            db.execute("SELECT name FROM sqlite_master LIMIT 1").fetchone()
        sqlite_ok = True
    except Exception:
        failed.append({"level": "error", "code": "sqlite_unavailable", "path": "DB_PATH"})
    return (
        {
            "legacyCaptionStorage": {
                "TEMP_DIR": TEMP_DIR.exists() and os.access(TEMP_DIR, os.W_OK),
                "UPLOAD_DIR": UPLOAD_DIR.exists() and os.access(UPLOAD_DIR, os.W_OK),
                "MEDIA_DIR": MEDIA_DIR.exists() and os.access(MEDIA_DIR, os.W_OK),
                "CACHE_DIR": CACHE_DIR.exists() and os.access(CACHE_DIR, os.W_OK),
                "EXPORT_DIR": EXPORT_DIR.exists() and os.access(EXPORT_DIR, os.W_OK),
                "DB_PATH_PARENT": DB_PATH.parent.exists()
                and os.access(DB_PATH.parent, os.W_OK),
                "sqliteOpen": sqlite_ok,
                "diskRejectUploadFreeBytes": DISK_REJECT_UPLOAD_FREE_BYTES,
                "findings": failed,
            }
        },
        not failed,
    )


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
            storage_config = MediaStorageConfig.from_env()
            buckets: dict[str, Any] = {}
            source_limit = None
            if storage_config.storage_provider == "supabase":
                bucket_rows = _query_one(
                    connection,
                    """
                    SELECT COALESCE(
                      jsonb_object_agg(
                        id,
                        jsonb_build_object('public', public, 'fileSizeLimit', file_size_limit)
                      ),
                      '{}'::jsonb
                    )
                    FROM storage.buckets WHERE id = ANY(%s)
                    """,
                    (list(BUCKETS),),
                )
                buckets = dict(bucket_rows[0] or {})
                source_bucket = buckets.get("source-media") or {}
                source_limit = source_bucket.get("fileSizeLimit")
                source_limit = int(source_limit) if source_limit is not None else None
            app_limit = storage_config.maximum_upload_bytes
            warnings = ["storage_global_limit_unverified"]
            failures: list[str] = []
            if source_limit is not None and source_limit < app_limit:
                failures.append("source_bucket_limit_too_low")
            r2_ok = (
                storage_config.storage_provider != "r2"
                or (
                    bool(storage_config.r2_endpoint_url)
                    and bool(storage_config.r2_access_key_id)
                    and bool(storage_config.r2_secret_access_key)
                    and bool(storage_config.r2_source_bucket)
                    and bool(storage_config.r2_variants_bucket)
                    and bool(storage_config.r2_exports_bucket)
                )
            )
            if not r2_ok:
                failures.append("r2_storage_not_configured")
            mode_row = _query_one(
                connection,
                "SELECT mode FROM site_access_policy WHERE id='global'",
            )
            report = {
                "database": "reachable",
                "migrationLedger": "present" if migration_table else "missing",
                "latestMigration": latest_name,
                "expectedLatestMigrationVersion": EXPECTED_MIGRATION,
                "applicationMaximumUploadBytes": app_limit,
                "sourceBucketMaximumUploadBytes": source_limit,
                "mediaStorageProvider": storage_config.storage_provider,
                "warnings": warnings,
                "failures": failures,
                "storageBuckets": {
                    name: {
                        "exists": name in buckets,
                        "private": (buckets.get(name) or {}).get("public") is False,
                        "fileSizeLimit": (buckets.get(name) or {}).get("fileSizeLimit"),
                    }
                    for name in BUCKETS
                },
                "siteAccessMode": mode_row[0] if mode_row else "public",
            }
            supabase_ok = storage_config.storage_provider != "supabase" or all(
                bucket.get("exists") and bucket.get("private")
                for bucket in report["storageBuckets"].values()
            )
            ok = (
                migration_table
                and latest_version >= EXPECTED_MIGRATION
                and supabase_ok
                and r2_ok
                and not failures
            )
            return report, ok
    except Exception as error:
        return {"database": "unreachable", "errorType": type(error).__name__}, False


def build_report() -> tuple[dict[str, Any], bool]:
    db, db_ok = _db_report()
    legacy, legacy_ok = _legacy_caption_report()
    ok = db_ok and legacy_ok
    report = {"status": "ok" if ok else "missing_setup", **_check_env(), **db, **legacy}
    return report, ok


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
