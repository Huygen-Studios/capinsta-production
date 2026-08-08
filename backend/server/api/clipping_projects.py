from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, Request

from ..auth import current_user
from ..automatic_clipper.config import AutomaticClipperConfig
from ..automatic_clipper.contracts import (
    CandidateDecisionRequestV1,
    CandidateRegenerateRequestV1,
    CandidateSelectionRequestV1,
)
from ..automatic_clipper.repository import AutomaticClipperRepository
from ..clipping_orchestration.config import ClippingOrchestrationConfig
from ..clipping_orchestration.contracts import (
    ConversionRequest,
    CreateProjectRequest,
    DeriveRequest,
    DraftRequest,
    RecommendationDecisionRequest,
    UpdateProjectRequest,
)
from ..clipping_orchestration.errors import OrchestrationError
from ..clipping_orchestration.identity import validate_idempotency_key
from ..clipping_orchestration.repository import ClippingOrchestrationRepository
from ..clipping_persistence.database import DurableDatabase
from ..clipping_persistence.errors import PersistenceError
from ..clipping_persistence.models import AuthenticatedActor
from ..pagination import encode_cursor, parse_cursor_page

router = APIRouter(prefix="/clipping/projects", tags=["clipping-projects"])


def _actor() -> AuthenticatedActor:
    return AuthenticatedActor.from_verified_user(current_user().id)


def _config() -> ClippingOrchestrationConfig:
    try:
        config = ClippingOrchestrationConfig.from_env()
    except ValueError as exc:
        raise HTTPException(
            503, detail={"code": "clipping_api_unavailable", "message": "Clipping API configuration is invalid"}
        ) from exc
    if not config.api_enabled:
        raise HTTPException(
            404, detail={"code": "clipping_api_disabled", "message": "Clipping project API is disabled"}
        )
    return config


def _repository() -> ClippingOrchestrationRepository:
    return ClippingOrchestrationRepository(DurableDatabase())


def _automatic_repository() -> AutomaticClipperRepository:
    return AutomaticClipperRepository(DurableDatabase())


def _automatic_config(*, smart_reframe: bool = False) -> AutomaticClipperConfig:
    config = AutomaticClipperConfig.from_env()
    enabled = (
        config.smart_reframe_enabled
        if smart_reframe
        else config.candidate_analysis_enabled
    )
    if not enabled:
        raise HTTPException(
            404,
            detail={
                "code": "automatic_clipper_disabled",
                "message": "Automatic clipping is disabled",
            },
        )
    return config


def _key(value: str) -> str:
    try:
        return validate_idempotency_key(value)
    except ValueError as exc:
        raise HTTPException(
            400, detail={"code": "invalid_idempotency_key", "message": "Idempotency-Key is invalid"}
        ) from exc


def _raise(error: Exception) -> None:
    if isinstance(error, OrchestrationError):
        raise HTTPException(
            error.status_code, detail={"code": error.code, "message": error.message}
        ) from error
    if isinstance(error, PersistenceError):
        status = {
            "entity_not_found": 404,
            "stale_revision": 409,
            "idempotency_conflict": 409,
            "idempotency_in_progress": 409,
            "database_unavailable": 503,
            "invalid_contract": 422,
        }.get(error.category, 422)
        raise HTTPException(
            status, detail={"code": error.category, "message": error.message}
        ) from error
    raise error


def _page(rows, limit, mapper, *, cursor_context=None):
    visible = rows[:limit]
    next_cursor = None
    if len(rows) > limit and visible:
        last = visible[-1]
        next_cursor = encode_cursor(
            created_at=str(last["created_at"]), item_id=str(last["id"]),
            context=cursor_context,
        )
    return {
        "items": [mapper(row) for row in visible],
        "pagination": {
            "limit": limit,
            "hasMore": len(rows) > limit,
            "nextCursor": next_cursor,
        },
    }


@router.post("", status_code=201)
async def create_project(body: CreateProjectRequest, idempotency_key: str = Header(alias="Idempotency-Key")):
    config = _config()
    key = _key(idempotency_key)
    from ..production.quotas import (
        QuotaExceededError,
        finish_reservation,
        reserve_project_admission,
    )

    try:
        reservation_key = await reserve_project_admission(
            user_id=current_user().id,
            media_asset_id=str(body.mediaAssetId),
            idempotency_key=key,
        )
        result = await _repository().create_project(
            _actor(), body, idempotency_key=key,
            maximum_ranges=config.maximum_ranges,
        )
        if reservation_key:
            await finish_reservation(reservation_key, committed=True)
        return result
    except QuotaExceededError as error:
        raise HTTPException(
            429,
            detail={"code": str(error), "message": "Your private-beta quota has been reached."},
        ) from error
    except (OrchestrationError, PersistenceError) as error:
        if 'reservation_key' in locals() and reservation_key:
            await finish_reservation(reservation_key, committed=False)
        _raise(error)


@router.get("")
async def list_projects(
    limit: int | None = Query(default=None),
    cursor: str | None = Query(default=None),
    archived: bool | None = Query(default=False),
    status: Literal["draft", "ready", "archived"] | None = Query(default=None),
):
    config = _config()
    cursor_context = f"projects:archived={archived}:status={status}"
    page = parse_cursor_page(
        limit=limit, cursor=cursor, cursor_context=cursor_context
    )
    if page.limit > config.maximum_page_size:
        raise HTTPException(400, detail={"code": "invalid_page_limit", "message": "Page limit is too large"})
    try:
        rows = await _repository().list_projects(
            _actor(), limit=page.limit, cursor_created_at=page.cursor_created_at,
            cursor_id=page.cursor_id, archived=archived,
            status=status,
        )
        return _page(rows, page.limit, lambda row: {
            "projectId": row["id"], "name": row["name"], "status": row["status"],
            "revision": row["revision"], "mediaAssetId": str(row["source_media_asset_id"]),
            "transcriptId": row["transcript_id"], "createdAt": row["created_at"],
            "updatedAt": row["updated_at"], "archivedAt": row["archived_at"],
        }, cursor_context=cursor_context)
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.get("/{project_id}")
async def get_project(project_id: str):
    _config()
    try:
        return await _repository().get_detail(_actor(), project_id)
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.get("/{project_id}/transcript")
async def get_project_transcript(project_id: str):
    _config()
    try:
        actor = _actor()
        detail = await _repository().get_detail(actor, project_id)
        async with DurableDatabase().connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """SELECT id,status,revision,document,quality,metadata
                    FROM transcripts WHERE id=%s AND owner_user_id=%s AND deleted_at IS NULL""",
                    (detail["project"]["transcriptId"], actor.user_id),
                )
                transcript = await cursor.fetchone()
        if transcript is None:
            raise OrchestrationError("transcript_not_ready", "Transcript is unavailable", 409)
        return {
            "transcript": dict(transcript),
            "analysisSummary": detail["analysisSummary"],
            "recommendationSummary": detail["recommendationSummary"],
        }
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.patch("/{project_id}")
async def update_project(
    project_id: str, body: UpdateProjectRequest,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    config = _config()
    try:
        return await _repository().update_project(
            _actor(), project_id, body, idempotency_key=_key(idempotency_key),
            maximum_ranges=config.maximum_ranges,
        )
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.post("/{project_id}/archive")
async def archive_project(project_id: str, idempotency_key: str = Header(alias="Idempotency-Key")):
    _config()
    try:
        return await _repository().lifecycle(
            _actor(), project_id, delete=False, idempotency_key=_key(idempotency_key)
        )
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.delete("/{project_id}")
async def delete_project(project_id: str, idempotency_key: str = Header(alias="Idempotency-Key")):
    _config()
    try:
        return await _repository().lifecycle(
            _actor(), project_id, delete=True, idempotency_key=_key(idempotency_key)
        )
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.get("/{project_id}/versions")
async def list_versions(
    project_id: str, limit: int | None = None, cursor: str | None = None
):
    config = _config()
    cursor_context = f"versions:project={project_id}"
    page = parse_cursor_page(
        limit=limit, cursor=cursor, cursor_context=cursor_context
    )
    if page.limit > config.maximum_page_size:
        raise HTTPException(400, detail={"code": "invalid_page_limit", "message": "Page limit is too large"})
    try:
        rows = await _repository().list_versions(
            _actor(), project_id, limit=page.limit,
            cursor_created_at=page.cursor_created_at, cursor_id=page.cursor_id,
        )
        return _page(rows, page.limit, lambda row: {
            "revision": row["revision"], "versionSource": row["version_source"],
            "changeSummary": row["change_summary"],
            "transcriptRevision": row["transcript_revision"],
            "derivationIdentity": row["derivation_identity"],
            "createdAt": row["created_at"],
        }, cursor_context=cursor_context)
    except (OrchestrationError, PersistenceError, ValueError) as error:
        if isinstance(error, ValueError):
            raise HTTPException(400, detail={"code": "invalid_cursor", "message": "Pagination cursor is invalid"}) from error
        _raise(error)


@router.get("/{project_id}/versions/{revision}")
async def get_version(project_id: str, revision: int):
    _config()
    try:
        return await _repository().get_version(_actor(), project_id, revision)
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.get("/{project_id}/recommendations")
async def list_recommendations(
    project_id: str, limit: int | None = None, cursor: str | None = None,
    status: Literal["proposed", "accepted", "rejected", "superseded"] | None = "proposed",
    recommendation_type: str | None = Query(default=None, alias="recommendationType"),
    analysis_id: str | None = Query(default=None, alias="analysisId"),
    timed: bool | None = None,
):
    config = _config()
    cursor_context = (
        f"recommendations:project={project_id}:status={status}:"
        f"type={recommendation_type}:analysis={analysis_id}:timed={timed}"
    )
    page = parse_cursor_page(
        limit=limit, cursor=cursor, cursor_context=cursor_context
    )
    if page.limit > config.maximum_page_size:
        raise HTTPException(400, detail={"code": "invalid_page_limit", "message": "Page limit is too large"})
    try:
        rows = await _repository().list_recommendations(
            _actor(), project_id, limit=page.limit,
            cursor_created_at=page.cursor_created_at, cursor_id=page.cursor_id,
            status=status, recommendation_type=recommendation_type,
            analysis_id=analysis_id, timed=timed,
        )
        return _page(rows, page.limit, lambda row: {
            "recommendationId": row["id"], "analysisId": row["analysis_id"],
            "recommendationType": row["recommendation_type"],
            "sourceStartMs": row["source_start_ms"], "sourceEndMs": row["source_end_ms"],
            "wordIds": row["word_ids"], "segmentIds": row["segment_ids"],
            "reasonCode": row["reason_code"], "severity": row["severity"],
            "analysisConfidence": float(row["confidence"]) if row["confidence"] is not None else None,
            "proposedAction": row["recommendation"]["proposedAction"],
            "status": row["status"],
            "decision": {
                "decidedAt": row["decided_at"], "note": row["decision_note"],
                "projectRevision": row["decision_project_revision"],
            } if row["decided_at"] else None,
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }, cursor_context=cursor_context)
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.post("/{project_id}/recommendations/decisions")
async def decide_recommendations(
    project_id: str, body: RecommendationDecisionRequest, request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    config = _config()
    if not config.decisions_enabled:
        raise HTTPException(404, detail={"code": "recommendation_decisions_disabled", "message": "Recommendation decisions are disabled"})
    if len(body.decisions) > config.maximum_decisions:
        raise HTTPException(422, detail={"code": "decision_batch_too_large", "message": "Decision batch is too large"})
    try:
        return await _repository().decide(
            _actor(), project_id, body, idempotency_key=_key(idempotency_key),
            request_id=request.headers.get("x-request-id") or idempotency_key,
        )
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.post("/{project_id}/drafts/from-accepted-recommendations")
async def derive_draft(
    project_id: str, body: DraftRequest,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    config = _config()
    if not config.drafts_enabled:
        raise HTTPException(404, detail={"code": "accepted_recommendation_drafts_disabled", "message": "Accepted-recommendation drafts are disabled"})
    if body.recommendationIds and len(body.recommendationIds) > config.maximum_draft_recommendations:
        raise HTTPException(422, detail={"code": "draft_recommendation_limit", "message": "Too many draft recommendations"})
    try:
        return await _repository().derive_draft(
            _actor(), project_id, body, idempotency_key=_key(idempotency_key)
        )
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.get("/{project_id}/candidates")
async def list_candidates(project_id: str):
    _automatic_config()
    try:
        return await _automatic_repository().list_candidates(_actor(), project_id)
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.post("/{project_id}/candidates/regenerate", status_code=202)
async def regenerate_candidates(
    project_id: str,
    body: CandidateRegenerateRequestV1,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    _automatic_config()
    key = _key(idempotency_key)
    from ..production.quotas import (
        QuotaExceededError,
        finish_reservation,
        reserve_candidate_regeneration,
    )

    try:
        await reserve_candidate_regeneration(
            user_id=current_user().id,
            project_id=project_id,
            idempotency_key=key,
        )
        result = await _automatic_repository().plan_candidates(
            _actor(),
            project_id,
            expected_revision=body.expectedRevision,
            regeneration_key=key,
        )
        await finish_reservation(key, committed=True)
        return result
    except QuotaExceededError as error:
        raise HTTPException(
            429,
            detail={
                "code": str(error),
                "message": "Your candidate regeneration quota has been reached.",
            },
        ) from error
    except (OrchestrationError, PersistenceError) as error:
        await finish_reservation(key, committed=False)
        _raise(error)


@router.post("/{project_id}/candidates/{candidate_id}/select", status_code=202)
async def select_candidate(
    project_id: str,
    candidate_id: str,
    body: CandidateSelectionRequestV1,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    _automatic_config(smart_reframe=True)
    _key(idempotency_key)
    try:
        return await _automatic_repository().queue_selection(
            _actor(), project_id, candidate_id, body
        )
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.post("/{project_id}/candidates/{candidate_id}/reject")
async def reject_candidate(
    project_id: str,
    candidate_id: str,
    body: CandidateDecisionRequestV1,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    _automatic_config()
    _key(idempotency_key)
    try:
        return await _automatic_repository().reject_candidate(
            _actor(),
            project_id,
            candidate_id,
            expected_revision=body.expectedRevision,
        )
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.post("/{project_id}/derive", status_code=202)
@router.post("/{project_id}/derivations", status_code=202)
async def request_derivation(
    project_id: str, body: DeriveRequest,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    config = _config()
    if not config.derivations_enabled:
        raise HTTPException(404, detail={"code": "project_derivations_disabled", "message": "Project derivation requests are disabled"})
    try:
        return await _repository().request_derivation(
            _actor(), project_id, body, idempotency_key=_key(idempotency_key)
        )
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.post("/{project_id}/conversion", status_code=202)
async def request_conversion(
    project_id: str, body: ConversionRequest,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    config = _config()
    if not config.conversions_enabled:
        raise HTTPException(404, detail={"code": "project_conversion_disabled", "message": "Project conversion requests are disabled"})
    try:
        return await _repository().request_conversion(
            _actor(), project_id, body, idempotency_key=_key(idempotency_key)
        )
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.get("/{project_id}/status")
async def project_status(project_id: str):
    _config()
    try:
        return await _repository().status(_actor(), project_id)
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)


@router.get("/{project_id}/jobs/{job_id}")
async def get_project_job(project_id: str, job_id: UUID):
    _config()
    try:
        return await _repository().get_job(_actor(), project_id, job_id)
    except (OrchestrationError, PersistenceError) as error:
        _raise(error)
