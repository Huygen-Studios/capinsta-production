from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys

from server.automatic_clipper.session_service import ClipperSessionService
from server.clipping_persistence.database import DurableDatabase

logger = logging.getLogger("clipper_session_cleanup")


def _database_url() -> str:
    return (
        os.getenv("ADMIN_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or ""
    ).strip()


async def main_async(args: argparse.Namespace) -> int:
    database_url = _database_url()
    if not database_url:
        if args.json:
            print(json.dumps({"error": "database_not_configured"}))
        else:
            logger.error("Database URL is not configured")
        return 2

    database = DurableDatabase(database_url)
    service = ClipperSessionService(database)

    abandon_grace = int(os.getenv("CLIPPER_SESSION_ABANDON_GRACE_SECONDS", "300"))
    source_retention = int(os.getenv("CLIPPER_SOURCE_AFTER_EXPORT_RETENTION_MINUTES", "5"))
    export_retention = int(os.getenv("CLIPPER_EXPORT_DOWNLOAD_RETENTION_MINUTES", "30"))

    result = await service.run_cleanup_sweep(
        batch_size=args.batch_size,
        abandon_grace_seconds=abandon_grace,
        source_retention_minutes=source_retention,
        export_retention_minutes=export_retention,
        dry_run=args.dry_run,
    )

    if args.json:
        print(json.dumps(result))
    else:
        logger.info(
            "clipper_session_cleanup_completed sessions_found=%d sessions_cleaned=%d exports_expired=%d dry_run=%s",
            result["sessionsFound"],
            result["sessionsCleaned"],
            result["expiredExportsDeleted"],
            result["dryRun"],
        )

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Clipper session cleanup sweep")
    parser.add_argument("--dry-run", action="store_true", help="Perform dry run without deleting")
    parser.add_argument("--batch-size", type=int, default=50, help="Batch size for cleanup")
    parser.add_argument("--json", action="store_true", help="Output result as JSON")
    args = parser.parse_args()

    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
