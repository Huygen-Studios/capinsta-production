import asyncio

import aiosqlite
import pytest
from fastapi import HTTPException

from server.auth import (
    AuthenticatedUser,
    get_owned_job,
    reset_current_user,
    set_current_user,
    verify_access_token,
)


def test_invalid_token_is_unauthorized():
    with pytest.raises(HTTPException) as error:
        verify_access_token("not-a-jwt")
    assert error.value.status_code == 401


def test_cross_user_job_access_is_hidden(tmp_path):
    async def run():
        db_path = tmp_path / "ownership.sqlite"
        async with aiosqlite.connect(str(db_path)) as db:
            db.row_factory = aiosqlite.Row
            await db.execute(
                "CREATE TABLE jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)"
            )
            await db.execute(
                "INSERT INTO jobs (id, user_id) VALUES ('job-a', 'user-a')"
            )
            await db.commit()

            context = set_current_user(AuthenticatedUser(id="user-b"))
            try:
                with pytest.raises(HTTPException) as error:
                    await get_owned_job(db, "job-a")
                assert error.value.status_code == 404
            finally:
                reset_current_user(context)

    asyncio.run(run())
