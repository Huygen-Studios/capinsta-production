from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import psycopg


class WhopWebhookError(ValueError):
    pass


@dataclass(frozen=True)
class WhopEvent:
    event_id: str
    event_type: str
    event_timestamp: datetime
    whop_user_id: str
    membership_id: str
    product_id: str
    plan_id: str | None
    payload_hash: str


def verify_webhook(
    body: bytes,
    headers: Any,
    *,
    secret: str,
    now: int | None = None,
    tolerance_seconds: int = 300,
) -> None:
    webhook_id = (headers.get("webhook-id") or "").strip()
    timestamp = (headers.get("webhook-timestamp") or "").strip()
    signatures = (headers.get("webhook-signature") or "").split()
    if not webhook_id or not timestamp or not signatures or not secret:
        raise WhopWebhookError("missing_signature")
    try:
        sent_at = int(timestamp)
    except (ValueError, binascii.Error) as exc:
        raise WhopWebhookError("invalid_timestamp") from exc
    if abs((now or int(time.time())) - sent_at) > tolerance_seconds:
        raise WhopWebhookError("stale_timestamp")
    signed = f"{webhook_id}.{timestamp}.".encode() + body
    try:
        key = (
            base64.b64decode(secret.removeprefix("whsec_"), validate=True)
            if secret.startswith("whsec_")
            else secret.encode()
        )
    except ValueError as exc:
        raise WhopWebhookError("invalid_secret") from exc
    digest = base64.b64encode(
        hmac.new(key, signed, hashlib.sha256).digest()
    ).decode()
    if not any(
        value.startswith("v1,")
        and hmac.compare_digest(value.removeprefix("v1,"), digest)
        for value in signatures
    ):
        raise WhopWebhookError("invalid_signature")


def parse_membership_event(body: bytes, expected_product_id: str) -> WhopEvent:
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WhopWebhookError("invalid_json") from exc
    if not isinstance(payload, dict):
        raise WhopWebhookError("invalid_payload")
    event_type = payload.get("type")
    if event_type not in {"membership.activated", "membership.deactivated"}:
        raise WhopWebhookError("unsupported_event")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise WhopWebhookError("invalid_membership")
    user = data.get("user")
    product = data.get("product")
    plan = data.get("plan")
    values = {
        "event_id": payload.get("id"),
        "whop_user_id": user.get("id") if isinstance(user, dict) else None,
        "membership_id": data.get("id"),
        "product_id": product.get("id") if isinstance(product, dict) else None,
    }
    if not all(isinstance(value, str) and 5 < len(value) <= 160 for value in values.values()):
        raise WhopWebhookError("invalid_identifiers")
    if values["product_id"] != expected_product_id:
        raise WhopWebhookError("wrong_product")
    try:
        event_timestamp = datetime.fromisoformat(
            str(payload["timestamp"]).replace("Z", "+00:00")
        ).astimezone(timezone.utc)
    except (KeyError, TypeError, ValueError) as exc:
        raise WhopWebhookError("invalid_event_timestamp") from exc
    return WhopEvent(
        **values,
        event_type=event_type,
        event_timestamp=event_timestamp,
        plan_id=plan.get("id") if isinstance(plan, dict) else None,
        payload_hash=hashlib.sha256(body).hexdigest(),
    )


async def apply_membership_event(event: WhopEvent) -> str:
    database_url = (
        os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or ""
    ).strip()
    if not database_url:
        raise RuntimeError("database_unavailable")
    async with await psycopg.AsyncConnection.connect(
        database_url, connect_timeout=5
    ) as connection:
        async with connection.transaction():
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    INSERT INTO whop_webhook_events (
                      event_id,event_type,event_timestamp,whop_user_id,
                      membership_id,product_id,payload_hash
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (event_id) DO NOTHING
                    RETURNING event_id
                    """,
                    (
                        event.event_id,
                        event.event_type,
                        event.event_timestamp,
                        event.whop_user_id,
                        event.membership_id,
                        event.product_id,
                        event.payload_hash,
                    ),
                )
                if await cursor.fetchone() is None:
                    return "duplicate"
                await cursor.execute(
                    """
                    SELECT user_id,event_timestamp FROM whop_account_links
                    WHERE whop_user_id=%s FOR UPDATE
                    """,
                    (event.whop_user_id,),
                )
                link = await cursor.fetchone()
                if link is None:
                    await cursor.execute(
                        """
                        UPDATE whop_webhook_events
                        SET processing_status='ignored',processed_at=now(),
                            failure_code='account_not_linked'
                        WHERE event_id=%s
                        """,
                        (event.event_id,),
                    )
                    return "ignored"
                user_id, previous_timestamp = link
                if previous_timestamp and event.event_timestamp < previous_timestamp:
                    await cursor.execute(
                        """
                        UPDATE whop_webhook_events
                        SET processing_status='ignored',processed_at=now(),
                            failure_code='out_of_order'
                        WHERE event_id=%s
                        """,
                        (event.event_id,),
                    )
                    return "ignored"
                active = event.event_type == "membership.activated"
                state = "active" if active else "inactive"
                product_status = "granted" if active else "revoked"
                await cursor.execute(
                    """
                    UPDATE whop_account_links SET membership_id=%s,product_id=%s,
                      plan_id=%s,entitlement_state=%s,event_timestamp=%s,
                      last_verified_at=now(),updated_at=now()
                    WHERE user_id=%s
                    """,
                    (
                        event.membership_id,
                        event.product_id,
                        event.plan_id,
                        state,
                        event.event_timestamp,
                        user_id,
                    ),
                )
                await cursor.execute(
                    """
                    INSERT INTO app_product_entitlements (
                      user_id,product_id,status,reason,granted_at,revoked_at,updated_at
                    ) VALUES (%s,'clipper',%s,'whop_membership',now(),
                      CASE WHEN %s THEN NULL ELSE now() END,now())
                    ON CONFLICT (user_id,product_id) DO UPDATE SET
                      status=excluded.status,reason=excluded.reason,
                      revoked_at=excluded.revoked_at,updated_at=now()
                    """,
                    (user_id, product_status, active),
                )
                if active:
                    await cursor.execute(
                        """
                        UPDATE profiles SET product_access_status='approved',
                          product_access_updated_at=now(),updated_at=now()
                        WHERE user_id=%s AND account_status='active'
                        """,
                        (user_id,),
                    )
                await cursor.execute(
                    """
                    UPDATE whop_webhook_events
                    SET processing_status='processed',processed_at=now()
                    WHERE event_id=%s
                    """,
                    (event.event_id,),
                )
                return "processed"
