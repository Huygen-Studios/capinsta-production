import aiosqlite
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from ..auth import current_user
from ..database import DB_PATH, get_db
from ..project_deletion import delete_project_resources
from ..storage_paths import safe_identifier

router = APIRouter(prefix="/projects", tags=["projects"])


async def _run_deletion(project_id: str, user_id: str) -> None:
    try:
        await delete_project_resources(project_id, user_id)
    except Exception:
        async with aiosqlite.connect(str(DB_PATH)) as db:
            await db.execute(
                """
                UPDATE project_deletions
                SET status = 'failed', error_code = COALESCE(error_code, 'cleanup_failed')
                WHERE project_id = ? AND user_id = ?
                """,
                (project_id, user_id),
            )
            await db.commit()


@router.delete("/{project_id}", status_code=202)
async def delete_project(
    project_id: str,
    background_tasks: BackgroundTasks,
    db: aiosqlite.Connection = Depends(get_db),
):
    try:
        safe_identifier(project_id, label="project id")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    user_id = current_user().id
    existing = await (
        await db.execute(
            """
            SELECT status FROM project_deletions
            WHERE project_id = ? AND user_id = ?
            """,
            (project_id, user_id),
        )
    ).fetchone()
    if existing:
        if existing["status"] == "failed":
            await db.execute(
                """
                UPDATE project_deletions
                SET status = 'queued', error_code = NULL
                WHERE project_id = ? AND user_id = ?
                """,
                (project_id, user_id),
            )
            await db.commit()
            background_tasks.add_task(_run_deletion, project_id, user_id)
            return {
                "projectId": project_id,
                "status": "queued",
                "statusUrl": f"/api/projects/{project_id}/deletion",
            }
        return {
            "projectId": project_id,
            "status": existing["status"],
            "statusUrl": f"/api/projects/{project_id}/deletion",
        }
    owned = await (
        await db.execute(
            """
            SELECT 1 FROM jobs WHERE project_id = ? AND user_id = ?
            UNION ALL
            SELECT 1 FROM media_assets WHERE project_id = ? AND user_id = ?
            LIMIT 1
            """,
            (project_id, user_id, project_id, user_id),
        )
    ).fetchone()
    if not owned:
        return {
            "projectId": project_id,
            "status": "completed",
            "statusUrl": f"/api/projects/{project_id}/deletion",
        }
    await db.execute(
        """
        INSERT INTO project_deletions (
          project_id, user_id, status, requested_at, retained_metadata_json
        ) VALUES (?, ?, 'queued', CURRENT_TIMESTAMP, '{}')
        """,
        (project_id, user_id),
    )
    await db.commit()
    background_tasks.add_task(_run_deletion, project_id, user_id)
    return {
        "projectId": project_id,
        "status": "queued",
        "statusUrl": f"/api/projects/{project_id}/deletion",
    }


@router.get("/{project_id}/deletion")
async def project_deletion_status(
    project_id: str, db: aiosqlite.Connection = Depends(get_db)
):
    row = await (
        await db.execute(
            """
            SELECT status, error_code, requested_at, completed_at
            FROM project_deletions WHERE project_id = ? AND user_id = ?
            """,
            (project_id, current_user().id),
        )
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Deletion request not found.")
    return {
        "projectId": project_id,
        "status": row["status"],
        "errorCode": row["error_code"],
        "requestedAt": row["requested_at"],
        "completedAt": row["completed_at"],
    }
