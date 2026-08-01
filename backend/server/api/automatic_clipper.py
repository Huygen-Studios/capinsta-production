from __future__ import annotations

import logging
import os
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from ..auth import current_user
from ..automatic_clipper.session_service import ClipperSessionService
from ..automatic_clipper.workflow import AutomaticClipperWorkflowService
from ..clipping_orchestration.errors import OrchestrationError
from ..clipping_persistence.database import DurableDatabase
from ..clipping_persistence.errors import PersistenceError
from ..clipping_persistence.models import AuthenticatedActor

router = APIRouter(tags=["automatic-clipper"])
logger = logging.getLogger(__name__)


class TransferToEditorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    clipProjectId: str


class CreateRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mediaAssetId: UUID
    mode: Literal["new_upload", "reuse_existing_media"] = Field(
        default="new_upload"
    )


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


def _session_service() -> ClipperSessionService:
    return ClipperSessionService(DurableDatabase())


def _raise(
    error: Exception, *, request_id: str | None = None, stage: str | None = None
) -> None:
    if isinstance(error, OrchestrationError):
        raise HTTPException(
            error.status_code,
            detail={
                "code": error.code,
                "message": error.message,
                **({"stage": stage} if stage else {}),
                **({"requestId": request_id} if request_id else {}),
            },
        ) from error
    if isinstance(error, PersistenceError):
        status_code = {
            "entity_not_found": 404,
            "database_unavailable": 503,
            "schema_version_unsupported": 503,
        }.get(error.category, 409)
        raise HTTPException(
            status_code,
            detail={
                "code": error.category,
                "message": (
                    "The Automatic Clipper database migration is incomplete."
                    if error.category == "schema_version_unsupported"
                    else error.message
                ),
                **({"stage": stage} if stage else {}),
                **({"requestId": request_id} if request_id else {}),
            },
        ) from error
    raise error


def _request_id(request: Request) -> str:
    return (
        request.headers.get("x-request-id")
        or request.headers.get("x-correlation-id")
        or str(uuid4())
    )


# --- Run-based Endpoints ---

@router.post("/clipping/runs", status_code=201)
async def create_run(payload: CreateRunRequest, request: Request):
    req_id = _request_id(request)
    try:
        res = await _session_service().create_run(
            _actor(), payload.mediaAssetId, mode=payload.mode
        )
        if res.get("notFound"):
            raise HTTPException(
                404,
                detail={"code": "media_not_found", "message": "Media asset was not found"},
            )
        return res
    except HTTPException:
        raise
    except (OrchestrationError, PersistenceError) as error:
        _raise(error, request_id=req_id, stage="run_creation")
    except Exception as exc:
        logger.exception(
            "clipper_run_creation_failed request_id=%s exc_class=%s",
            req_id,
            type(exc).__name__,
        )
        raise HTTPException(
            500,
            detail={
                "code": "run_creation_failed",
                "message": "The clipping run could not be created.",
                "stage": "run_creation",
                "requestId": req_id,
            },
        ) from exc


@router.get("/clipping/runs/{run_id}")
async def get_run_status(run_id: UUID):
    run = await _session_service().get_run(_actor(), run_id)
    if run is None:
        raise HTTPException(
            404, detail={"code": "run_not_found", "message": "Clipper run was not found"}
        )
    result = await _service()._snapshot(_actor(), run["media_asset_id"], run_id=run_id)
    return await _service()._response(result)


@router.post("/clipping/runs/{run_id}/advance")
async def advance_run(run_id: UUID, request: Request):
    req_id = _request_id(request)
    try:
        run = await _session_service().get_run(_actor(), run_id)
        if run is None:
            raise HTTPException(
                404,
                detail={"code": "run_not_found", "message": "Clipper run was not found"},
            )
        response = await _service().advance(
            _actor(), run["media_asset_id"], run_id=run_id
        )
        if response["status"] == "not_found":
            raise HTTPException(
                404,
                detail={"code": "media_not_found", "message": "Media was not found"},
            )
        return response
    except HTTPException:
        raise
    except (OrchestrationError, PersistenceError) as error:
        _raise(error, request_id=req_id, stage="workflow_advance")
    except Exception as exc:
        logger.exception(
            "workflow_advance_failed run_id=%s request_id=%s exc_class=%s",
            run_id,
            req_id,
            type(exc).__name__,
        )
        raise HTTPException(
            500,
            detail={
                "code": "workflow_advance_failed",
                "message": "The clipping workflow could not advance.",
                "stage": "workflow_advance",
                "requestId": req_id,
            },
        )


@router.post("/clipping/runs/{run_id}/heartbeat")
async def run_heartbeat(run_id: UUID):
    run = await _session_service().record_run_heartbeat(_actor(), run_id)
    if run is None:
        raise HTTPException(
            404, detail={"code": "run_not_found", "message": "Clipper run was not found"}
        )
    return {"status": run.get("status", "active"), "runId": str(run_id)}


@router.delete("/clipping/runs/{run_id}")
async def delete_run(run_id: UUID):
    try:
        return await _session_service().delete_run(_actor(), run_id)
    except Exception as error:
        _raise(error)


# --- Legacy / Workflows Endpoints (Compatibility Wrappers) ---

@router.get("/clipping/workflows/{media_asset_id}")
async def workflow_status(media_asset_id: UUID):
    result = await _service()._snapshot(_actor(), media_asset_id)
    response = await _service()._response(result)
    if response["status"] == "not_found":
        raise HTTPException(
            404,
            detail={"code": "media_not_found", "message": "Media was not found"},
        )
    return response


@router.post("/clipping/workflows/{media_asset_id}/advance")
async def advance_workflow(media_asset_id: UUID, request: Request):
    req_id = _request_id(request)
    try:
        response = await _service().advance(_actor(), media_asset_id)
        if response["status"] == "not_found":
            raise HTTPException(
                404,
                detail={"code": "media_not_found", "message": "Media was not found"},
            )
        return response
    except HTTPException:
        raise
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)
    except Exception as exc:
        logger.exception(
            "workflow_advance_failed media_asset_id=%s request_id=%s exc_class=%s",
            media_asset_id,
            req_id,
            type(exc).__name__,
        )
        raise HTTPException(
            500,
            detail={
                "code": "workflow_advance_failed",
                "message": "The clipping workflow could not advance.",
                "stage": "workflow_advance",
                "requestId": req_id,
            },
        )


@router.post("/clipping/workflows/{media_asset_id}/heartbeat")
async def session_heartbeat(media_asset_id: UUID):
    session = await _session_service().record_heartbeat(_actor(), media_asset_id)
    return {"status": session.get("status", "active"), "mediaAssetId": str(media_asset_id)}


@router.post("/clipping/workflows/{media_asset_id}/transfer-to-editor")
async def transfer_to_editor(media_asset_id: UUID, payload: TransferToEditorRequest):
    session = await _session_service().transfer_to_editor(
        _actor(), media_asset_id, payload.clipProjectId
    )
    return {
        "status": session.get("status", "transferred_to_editor"),
        "mediaAssetId": str(media_asset_id),
        "clipProjectId": payload.clipProjectId,
    }


@router.delete("/clipping/workflows/{media_asset_id}")
async def delete_workflow_session(media_asset_id: UUID):
    try:
        return await _session_service().delete_session_media(_actor(), media_asset_id)
    except Exception as error:
        _raise(error)
