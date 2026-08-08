from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import psycopg

from ..clipping_storage.config import MediaStorageConfig
from ..clipping_storage.provider import media_storage_from_config
from .cleanup import _abort_multipart


async def run(
    *, dry_run: bool = True, batch_size: int = 100, older_than_hours: int = 2
) -> dict[str, int | bool]:
    database_url = (
        os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or ""
    ).strip()
    limit = max(1, min(batch_size, 2_000))
    cutoff = datetime.now(timezone.utc) - timedelta(
        hours=max(1, older_than_hours)
    )
    report: dict[str, int | bool] = {
        "dryRun": dry_run,
        "matched": 0,
        "aborted": 0,
        "missingPersistedUploadId": 0,
        "failed": 0,
    }
    async with await psycopg.AsyncConnection.connect(
        database_url, connect_timeout=5
    ) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                SELECT id,storage_provider,storage_bucket,storage_path,status,
                  provider_upload_id,multipart_upload_id
                FROM media_upload_sessions
                WHERE storage_provider='r2'
                  AND upload_protocol='s3_multipart'
                  AND COALESCE(multipart_state,'created') <> 'completed'
                  AND (
                    expires_at < %s
                    OR (status IN ('failed','expired','cancelled') AND updated_at < %s)
                  )
                ORDER BY updated_at
                LIMIT %s
                """,
                (cutoff, cutoff, limit),
            )
            rows = await cursor.fetchall()
        report["matched"] = len(rows)
        if dry_run:
            report["missingPersistedUploadId"] = sum(
                1 for row in rows if not (row[5] or row[6])
            )
            return report

        storage = media_storage_from_config(MediaStorageConfig.from_env())
        for row in rows:
            session_id, _, bucket, path, status, provider_id, multipart_id = row
            upload_id = provider_id or multipart_id
            if not upload_id:
                report["missingPersistedUploadId"] += 1
            elif await _abort_multipart(
                storage, str(bucket), str(path), str(upload_id)
            ):
                report["aborted"] += 1
            else:
                report["failed"] += 1
                continue
            async with connection.transaction():
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        UPDATE media_upload_sessions
                        SET status=CASE
                              WHEN status IN ('failed','expired','cancelled') THEN status
                              ELSE 'expired'
                            END,
                            failed_at=COALESCE(failed_at,now()),
                            multipart_state=CASE
                              WHEN %s THEN 'aborted'
                              ELSE multipart_state
                            END,
                            aborted_at=CASE
                              WHEN %s THEN COALESCE(aborted_at,now())
                              ELSE aborted_at
                            END,
                            updated_at=now()
                        WHERE id=%s AND status <> 'completed'
                        """,
                        (bool(upload_id), bool(upload_id), session_id),
                    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Safely reconcile expired Capinsta R2 multipart sessions."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--execute", action="store_true")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--older-than-hours", type=int, default=2)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        report = asyncio.run(
            run(
                dry_run=not args.execute,
                batch_size=args.batch_size,
                older_than_hours=args.older_than_hours,
            )
        )
    except Exception as error:
        report = {
            "dryRun": not args.execute,
            "failed": 1,
            "errorType": type(error).__name__,
        }
    if args.json:
        print(json.dumps(report, sort_keys=True))
    else:
        for key, value in report.items():
            print(f"{key}: {value}")
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
