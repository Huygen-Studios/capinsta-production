from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, HTTPException

from ..auth import current_user
from ..automatic_clipper.workflow import AutomaticClipperWorkflowService
from ..clipping_orchestration.errors import OrchestrationError
from ..clipping_persistence.database import DurableDatabase
from ..clipping_persistence.errors import PersistenceError
from ..clipping_persistence.models import AuthenticatedActor

router = APIRouter(prefix="/clipping/workflows", tags=["automatic-clipper"])


def _enabled() -> bool:
    return os.getenv("ENABLE_CLIPPER_UI", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _actor() -> AuthenticatedActor:
    return AuthenticatedActor.from_verified_user(current_user().id)


def _service() -> AutomaticClipperWorkflowService:
    if not _enabled():
        raise HTTPException(
            404,
            detail={
                "code": "clipper_ui_disabled",
                "message": "Automatic clipper workflow is disabled",
            },
        )
    return AutomaticClipperWorkflowService(DurableDatabase())


def _raise(error: Exception) -> None:
    if isinstance(error, OrchestrationError):
        raise HTTPException(
            error.status_code, detail={"code": error.code, "message": error.message}
        ) from error
    if isinstance(error, PersistenceError):
        raise HTTPException(
            409, detail={"code": error.category, "message": error.message}
        ) from error
    raise error


@router.get("/{media_asset_id}")
async def workflow_status(media_asset_id: UUID):
    result = await _service()._snapshot(_actor(), media_asset_id)
    response = _service()._response(result)
    if response["status"] == "not_found":
        raise HTTPException(
            404,
            detail={"code": "media_not_found", "message": "Media was not found"},
        )
    return response


@router.post("/{media_asset_id}/advance")
async def advance_workflow(media_asset_id: UUID):
    try:
        response = await _service().advance(_actor(), media_asset_id)
        if response["status"] == "not_found":
            raise HTTPException(
                404,
                detail={"code": "media_not_found", "message": "Media was not found"},
            )
        return response
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)
