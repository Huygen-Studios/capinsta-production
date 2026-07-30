from __future__ import annotations

import argparse
import asyncio
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import Any
from uuid import uuid4

try:
    import psycopg
except Exception:  # pragma: no cover - optional production dependency
    psycopg = None

from ai_pipeline.timing import check_silero_readiness
from server.api.health import API_CAPABILITIES, API_CONTRACT_VERSION
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.errors import StorageError
from server.clipping_storage.provider import media_storage_from_config
from server.clipping_storage.r2_storage import R2MediaStorage
from server.clipping_storage.paths import source_object_path
from server.clipping_storage.repository import r2_schema_findings
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
            "accountIdConfigured": bool(storage.r2_account_id),
            "endpointConfigured": bool(storage.r2_endpoint_url),
            "sourceBucket": storage.r2_source_bucket,
            "variantsBucket": storage.r2_variants_bucket,
            "exportsBucket": storage.r2_exports_bucket,
            "partSizeBytes": storage.r2_part_size_bytes,
            "signedUrlTtlSeconds": storage.r2_signed_url_ttl_seconds,
            "uploadConcurrency": storage.r2_upload_concurrency,
            "signBatchSize": storage.r2_sign_batch_size,
            "connectTimeoutSeconds": storage.r2_connect_timeout_seconds,
            "readTimeoutSeconds": storage.r2_read_timeout_seconds,
            "maxRetryAttempts": storage.r2_max_retry_attempts,
            "verifyTls": storage.r2_verify_tls,
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


def _safe_env_report() -> tuple[dict[str, Any], bool]:
    try:
        return _check_env(), True
    except StorageError as error:
        return (
            {
                "backendApiContractVersion": API_CONTRACT_VERSION,
                "routeCapabilities": API_CAPABILITIES,
                "mediaStorageProvider": (
                    os.getenv("CLIPPING_STORAGE_PROVIDER") or ""
                ).strip().lower(),
                "r2Storage": {"configured": False, "error": error.category},
                "uploadAdmission": "unknown",
                "candidateAdmission": "unknown",
                "exportAdmission": "unknown",
                "transcriptionProvider": "unknown",
                "candidateProvider": "unknown",
            },
            False,
        )


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


def _r2_error_code(error: Exception) -> str:
    if isinstance(error, StorageError):
        return error.category
    return type(error).__name__


async def _r2_write_test(storage: R2MediaStorage) -> dict[str, Any]:
    owner = uuid4()
    asset = uuid4()
    path = source_object_path(
        owner_user_id=owner, media_asset_id=asset, mime_type="video/mp4"
    )
    payload = b"capinsta-r2-doctor\n"
    with tempfile.NamedTemporaryFile(delete=False) as temp:
        temp.write(payload)
        temp_path = Path(temp.name)
    try:
        metadata = await storage.upload_file(
            bucket=storage.config.source_bucket,
            path=path,
            local_path=temp_path,
            content_type="video/mp4",
            maximum_bytes=len(payload),
            checksum="doctor-write-test",
            overwrite=True,
        )
        await storage.create_read_url(
            bucket=storage.config.source_bucket, path=path, expires_in=60
        )
        await storage.delete_object(bucket=storage.config.source_bucket, path=path)

        multipart_path = source_object_path(
            owner_user_id=owner, media_asset_id=asset, mime_type="video/mp4", version=2
        )
        upload_id = await storage.create_multipart_upload(
            bucket=storage.config.source_bucket,
            path=multipart_path,
            mime_type="video/mp4",
        )
        await storage.abort_multipart_upload(
            bucket=storage.config.source_bucket,
            path=multipart_path,
            upload_id=upload_id,
        )
        return {
            "status": "ok",
            "putObject": "ok",
            "headObject": "ok" if metadata.size_bytes == len(payload) else "mismatch",
            "signedGet": "ok",
            "multipartCreateAbort": "ok",
        }
    finally:
        temp_path.unlink(missing_ok=True)


def _r2_runtime_report(*, write_test: bool = False) -> tuple[dict[str, Any], bool]:
    try:
        config = MediaStorageConfig.from_env()
    except StorageError as error:
        return {
            "r2Runtime": {
                "checked": True,
                "client": "failed",
                "error": error.category,
            }
        }, False
    if config.storage_provider != "r2":
        return {"r2Runtime": {"checked": False, "reason": "provider_not_r2"}}, True
    try:
        storage = media_storage_from_config(config)
    except Exception as error:
        return {
            "r2Runtime": {
                "checked": True,
                "client": "failed",
                "error": _r2_error_code(error),
            }
        }, False
    if not isinstance(storage, R2MediaStorage):
        return {
            "r2Runtime": {
                "checked": True,
                "client": "failed",
                "error": "wrong_storage_provider",
            }
        }, False

    bucket_map = {
        config.source_bucket: config.r2_source_bucket,
        config.variants_bucket: config.r2_variants_bucket,
        config.exports_bucket: config.r2_exports_bucket,
    }
    buckets: dict[str, Any] = {}
    ok = True
    for logical, physical in bucket_map.items():
        try:
            storage.client.head_bucket(Bucket=physical)
            buckets[logical] = {
                "bucket": physical,
                "reachable": True,
                "private": "not_publicly_detectable",
            }
        except Exception as error:
            ok = False
            buckets[logical] = {
                "bucket": physical,
                "reachable": False,
                "error": _r2_error_code(error),
            }

    presigning = "ok"
    try:
        storage.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": config.r2_source_bucket, "Key": "doctor/presign-check"},
            ExpiresIn=60,
            HttpMethod="GET",
        )
    except Exception as error:
        ok = False
        presigning = _r2_error_code(error)

    write: dict[str, Any] = {"status": "skipped"}
    if write_test:
        try:
            write = asyncio.run(_r2_write_test(storage))
        except Exception as error:
            ok = False
            write = {"status": "failed", "error": _r2_error_code(error)}

    return {
        "r2Runtime": {
            "checked": True,
            "client": "ok",
            "buckets": buckets,
            "presigning": presigning,
            "writeTest": write,
            "cors": "not_verifiable_without_browser_preflight",
        }
    }, ok


def _query_one(connection: Any, query: str, params: tuple[Any, ...] = ()) -> Any:
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        return cursor.fetchone()


def _r2_database_schema_report(connection: Any) -> tuple[dict[str, Any], bool]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name='media_upload_sessions'
            """
        )
        columns = {str(row[0]) for row in cursor.fetchall()}
        cursor.execute(
            """
            SELECT conname,pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid=to_regclass('public.media_upload_sessions')
            """
        )
        constraints = {str(row[0]): str(row[1]) for row in cursor.fetchall()}
    findings = r2_schema_findings(columns, constraints)
    return {
        "r2DatabaseSchema": {
            "ready": not findings,
            "findings": findings,
        }
    }, not findings


def _db_report() -> tuple[dict[str, Any], bool]:
    url = _database_url()
    if not url:
        return {"database": "missing_database_url"}, False
    if psycopg is None:
        return {"database": "psycopg_not_installed"}, False
    storage_error: StorageError | None = None
    try:
        storage_config = MediaStorageConfig.from_env()
    except StorageError as error:
        storage_config = None
        storage_error = error

    try:
        with psycopg.connect(url, connect_timeout=5) as connection:
            r2_schema, r2_schema_ok = _r2_database_schema_report(connection)
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
            buckets: dict[str, Any] = {}
            source_limit = None
            if storage_config and storage_config.storage_provider == "supabase":
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
            app_limit = (
                storage_config.maximum_upload_bytes
                if storage_config
                else 2 * 1024 * 1024 * 1024
            )
            warnings = ["storage_global_limit_unverified"]
            failures: list[str] = []
            if storage_error:
                failures.append(storage_error.category)
            if source_limit is not None and source_limit < app_limit:
                failures.append("source_bucket_limit_too_low")
            r2_ok = (
                not storage_config
                or storage_config.storage_provider != "r2"
                or (
                    bool(storage_config.r2_account_id)
                    and bool(storage_config.r2_endpoint_url)
                    and bool(storage_config.r2_access_key_id)
                    and bool(storage_config.r2_secret_access_key)
                    and bool(storage_config.r2_source_bucket)
                    and bool(storage_config.r2_variants_bucket)
                    and bool(storage_config.r2_exports_bucket)
                )
            )
            if not r2_ok:
                failures.append("r2_storage_not_configured")
            if not r2_schema_ok:
                failures.append("storage_schema_outdated")
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
                "mediaStorageProvider": (
                    storage_config.storage_provider
                    if storage_config
                    else (os.getenv("CLIPPING_STORAGE_PROVIDER") or "").strip().lower()
                ),
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
                **r2_schema,
            }
            supabase_ok = (
                not storage_config
                or storage_config.storage_provider != "supabase"
                or all(
                    bucket.get("exists") and bucket.get("private")
                    for bucket in report["storageBuckets"].values()
                )
            )
            ok = (
                migration_table
                and latest_version >= EXPECTED_MIGRATION
                and storage_error is None
                and supabase_ok
                and r2_ok
                and r2_schema_ok
                and not failures
            )
            return report, ok
    except Exception as error:
        return {"database": "unreachable", "errorType": type(error).__name__}, False


def _silero_vad_report() -> tuple[dict[str, Any], bool]:
    readiness = check_silero_readiness(force_recheck=True)
    silero_enabled = readiness["sileroEnabled"]
    silero_required = readiness["sileroRequired"]
    inference_ready = readiness["sileroInferenceReady"]
    fallback_available = readiness["fallbackAvailable"]
    failure_category = readiness["failureCategory"]

    if silero_required and not inference_ready:
        status_code = "silero_vad_required_unavailable"
        ok = False
    elif silero_enabled and not inference_ready:
        if fallback_available:
            status_code = "silero_vad_degraded_fallback_available"
            ok = True
        else:
            status_code = "silero_vad_unavailable_no_fallback"
            ok = False
    else:
        status_code = "silero_vad_ready"
        ok = True

    report = {
        "sileroVad": {
            "status": status_code,
            "sileroEnabled": silero_enabled,
            "sileroRequired": silero_required,
            "sileroImportable": readiness["sileroImportable"],
            "sileroModelLoadable": readiness["sileroModelLoadable"],
            "sileroInferenceReady": inference_ready,
            "sileroVersion": readiness["sileroVersion"],
            "failureCategory": failure_category,
            "fallbackAvailable": fallback_available,
        }
    }
    return report, ok


def build_report(*, write_test: bool = False) -> tuple[dict[str, Any], bool]:
    env, env_ok = _safe_env_report()
    db, db_ok = _db_report()
    legacy, legacy_ok = _legacy_caption_report()
    r2, r2_ok = _r2_runtime_report(write_test=write_test)
    silero, silero_ok = _silero_vad_report()
    ok = env_ok and db_ok and legacy_ok and r2_ok and silero_ok
    report = {
        "status": "ok" if ok else "missing_setup",
        **env,
        **db,
        **legacy,
        **r2,
        **silero,
    }
    return report, ok


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only Capinsta production doctor.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument(
        "--write-test",
        action="store_true",
        help="Run a tiny R2 write/delete and multipart create/abort check.",
    )
    parser.add_argument(
        "--check-silero",
        action="store_true",
        help="Run Silero VAD readiness check and print details.",
    )
    args = parser.parse_args()
    report, ok = build_report(write_test=args.write_test)
    if args.check_silero:
        print(json.dumps(report.get("sileroVad", {}), indent=2))
        return 0 if (report.get("sileroVad", {}).get("status") in {"silero_vad_ready", "silero_vad_degraded_fallback_available"}) else 1
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        for key, value in report.items():
            print(f"{key}: {value}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
