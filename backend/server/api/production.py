import os

from fastapi import APIRouter, HTTPException, Request

from ..rate_limit import enforce_whop_webhook_rate_limit
from ..production.whop import (
    WhopWebhookError,
    apply_membership_event,
    parse_membership_event,
    verify_webhook,
)

router = APIRouter(tags=["production"])


def _enabled(name: str) -> bool:
    return (os.getenv(name) or "false").strip().lower() in {"1", "true", "yes", "on"}


@router.post("/webhooks/whop")
async def whop_webhook(request: Request):
    if not _enabled("ENABLE_WHOP_ACCESS"):
        raise HTTPException(status_code=404, detail="Not found")
    await enforce_whop_webhook_rate_limit(request)
    body = await request.body()
    if len(body) > 262_144:
        raise HTTPException(status_code=413, detail="Webhook is too large")
    try:
        verify_webhook(
            body,
            request.headers,
            secret=(os.getenv("WHOP_WEBHOOK_SECRET") or "").strip(),
        )
        event = parse_membership_event(
            body, (os.getenv("WHOP_PRODUCT_ID") or "").strip()
        )
    except WhopWebhookError as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook") from exc
    return {"status": await apply_membership_event(event)}
