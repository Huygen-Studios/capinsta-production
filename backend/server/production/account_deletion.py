from __future__ import annotations

import argparse
import asyncio
import logging
import os

import psycopg
import requests

from ..clipping_storage.config import MediaStorageConfig
from ..clipping_storage.errors import StorageError
from ..clipping_storage.supabase_storage import SupabaseMediaStorage

logger = logging.getLogger(__name__)


async def _objects(cursor, user_id: str) -> list[tuple[str, str]]:
    await cursor.execute(
        """
        SELECT storage_bucket,storage_path FROM media_assets
          WHERE owner_user_id=%s::uuid AND storage_bucket IS NOT NULL AND storage_path IS NOT NULL
        UNION
        SELECT v.storage_bucket,v.storage_path FROM media_variants v
          JOIN media_assets a ON a.id=v.media_asset_id
          WHERE a.owner_user_id=%s::uuid
            AND v.storage_bucket IS NOT NULL AND v.storage_path IS NOT NULL
        UNION
        SELECT storage_bucket,storage_path FROM clipping_exports
          WHERE owner_user_id=%s::uuid AND storage_bucket IS NOT NULL AND storage_path IS NOT NULL
        """,
        (user_id, user_id, user_id),
    )
    return [(str(row[0]), str(row[1])) for row in await cursor.fetchall()]


async def run_batch(*, dry_run: bool = False, batch_size: int = 10) -> dict[str, int]:
    database_url = (
        os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or ""
    ).strip()
    config = MediaStorageConfig.from_env()
    storage = SupabaseMediaStorage(config)
    counts = {"selected": 0, "completed": 0, "failed": 0, "objects": 0}
    async with await psycopg.AsyncConnection.connect(
        database_url, connect_timeout=5
    ) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                SELECT user_id FROM account_deletion_requests
                WHERE status IN ('requested','failed') AND attempt_count < 20
                ORDER BY requested_at LIMIT %s
                """,
                (max(1, min(batch_size, 100)),),
            )
            users = [str(row[0]) for row in await cursor.fetchall()]
        counts["selected"] = len(users)
        for user_id in users:
            try:
                async with connection.transaction():
                    async with connection.cursor() as cursor:
                        if not dry_run:
                            await cursor.execute(
                                """
                                UPDATE account_deletion_requests
                                SET status='deleting',started_at=COALESCE(started_at,now()),
                                  attempt_count=attempt_count+1,safe_failure_code=NULL,updated_at=now()
                                WHERE user_id=%s::uuid
                                """,
                                (user_id,),
                            )
                        objects = await _objects(cursor, user_id)
                counts["objects"] += len(objects)
                if dry_run:
                    continue
                for bucket, path in objects:
                    try:
                        await storage.delete_object(bucket=bucket, path=path)
                    except StorageError as exc:
                        if exc.category != "object_not_found":
                            raise
                async with connection.transaction():
                    async with connection.cursor() as cursor:
                        await cursor.execute(
                            "DELETE FROM whop_account_links WHERE user_id=%s::uuid",
                            (user_id,),
                        )
                        await cursor.execute(
                            "DELETE FROM app_product_entitlements WHERE user_id=%s::uuid",
                            (user_id,),
                        )
                        await cursor.execute(
                            "DELETE FROM usage_reservations WHERE user_id=%s::uuid",
                            (user_id,),
                        )
                        await cursor.execute(
                            "UPDATE usage_events SET user_id=NULL WHERE user_id=%s::uuid",
                            (user_id,),
                        )
                        await cursor.execute(
                            """
                            UPDATE account_deletion_requests SET storage_deleted=true,
                              updated_at=now() WHERE user_id=%s::uuid
                            """,
                            (user_id,),
                        )
                supabase_url = config.supabase_url.rstrip("/")
                response = await asyncio.to_thread(
                    requests.delete,
                    f"{supabase_url}/auth/v1/admin/users/{user_id}",
                    headers={
                        "Authorization": f"Bearer {config.service_role_key}",
                        "apikey": config.service_role_key,
                    },
                    timeout=10,
                )
                if response.status_code not in {200, 204, 404}:
                    response.raise_for_status()
                counts["completed"] += 1
            except Exception as exc:
                counts["failed"] += 1
                logger.error(
                    "account_deletion_failed user_id=%s category=%s",
                    user_id,
                    type(exc).__name__,
                )
                await connection.execute(
                    """
                    UPDATE account_deletion_requests SET status='failed',
                      safe_failure_code='deletion_failed',updated_at=now()
                    WHERE user_id=%s::uuid
                    """,
                    (user_id,),
                )
                await connection.commit()
    logger.info("account_deletion_batch counts=%s dry_run=%s", counts, dry_run)
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=10)
    args = parser.parse_args()
    raise SystemExit(
        0
        if asyncio.run(run_batch(dry_run=args.dry_run, batch_size=args.batch_size))
        is not None
        else 1
    )
