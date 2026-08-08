from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import time
from dataclasses import dataclass

import requests
from fastapi import HTTPException, Request

from .auth import AuthenticatedUser
from .api_versioning import canonical_api_path


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    limit: int
    window_seconds: int


ROUTE_RULES: tuple[tuple[str, str, RateLimitRule], ...] = (
    ("POST", "/api/media/assets", RateLimitRule("upload-start", 20, 15 * 60)),
    ("POST", "/api/jobs", RateLimitRule("caption-start", 10, 15 * 60)),
    ("POST", "/api/export/jobs", RateLimitRule("export-start", 10, 15 * 60)),
    ("POST", "/api/clipping/projects", RateLimitRule("clipping-mutation", 30, 15 * 60)),
    ("POST", "/api/clipping/handoffs", RateLimitRule("handoff-start", 20, 15 * 60)),
    ("POST", "/api/clipping/media", RateLimitRule("signed-media", 60, 15 * 60)),
    ("GET", "/api/jobs", RateLimitRule("job-read", 240, 60)),
    ("GET", "/api/export/jobs", RateLimitRule("export-read", 240, 60)),
)


def _configured() -> bool:
    return bool(os.getenv("UPSTASH_REDIS_REST_URL") and os.getenv("UPSTASH_REDIS_REST_TOKEN"))


def _hmac_key(value: str) -> str:
    secret = (
        os.getenv("RATE_LIMIT_KEY_SECRET")
        or os.getenv("INTERNAL_MAINTENANCE_SECRET")
        or os.getenv("SUPABASE_JWT_SECRET")
        or "capinsta-development-rate-limit"
    ).encode("utf-8")
    return hmac.new(secret, value.encode("utf-8"), hashlib.sha256).hexdigest()


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    trusted_proxy = (os.getenv("TRUSTED_PROXY_MODE") or "none").strip().lower()
    if forwarded and trusted_proxy in {"coolify", "cloudflare"}:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def _route_rule(request: Request) -> RateLimitRule | None:
    path = canonical_api_path(request.url.path.rstrip("/") or "/")
    method = request.method.upper()
    for rule_method, prefix, rule in ROUTE_RULES:
        if method == rule_method and (path == prefix or path.startswith(f"{prefix}/")):
            return rule
    return None


def _redis_request(path: str) -> dict:
    url = os.getenv("UPSTASH_REDIS_REST_URL", "").rstrip("/")
    token = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")
    response = requests.post(
        f"{url}{path}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=3,
    )
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


def _consume(rule: RateLimitRule, key: str) -> tuple[bool, int]:
    bucket = int(time.time() // rule.window_seconds)
    redis_key = f"rl:{rule.name}:{bucket}:{key}"
    count = int(_redis_request(f"/incr/{redis_key}").get("result") or 0)
    if count == 1:
        _redis_request(f"/expire/{redis_key}/{rule.window_seconds}")
    retry_after = max(1, ((bucket + 1) * rule.window_seconds) - int(time.time()))
    return count <= rule.limit, retry_after


async def enforce_api_rate_limit(request: Request, user: AuthenticatedUser) -> None:
    rule = _route_rule(request)
    if rule is None:
        return
    if not _configured():
        if os.getenv("NODE_ENV") == "production":
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "rate_limit_unavailable",
                    "message": "Rate limit service is unavailable.",
                },
            )
        return
    identity = _hmac_key(f"user:{user.id}:ip:{_client_ip(request)}")
    try:
        allowed, retry_after = await asyncio.to_thread(_consume, rule, identity)
    except Exception as exc:
        if os.getenv("NODE_ENV") == "production":
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "rate_limit_unavailable",
                    "message": "Rate limit service is unavailable.",
                },
            ) from exc
        return
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "Too many requests. Please try again later."},
            headers={"Retry-After": str(retry_after)},
        )


async def enforce_whop_webhook_rate_limit(request: Request) -> None:
    if not _configured():
        if os.getenv("NODE_ENV") == "production":
            raise HTTPException(status_code=503, detail="Webhook unavailable")
        return
    rule = RateLimitRule("whop-webhook", 120, 60)
    try:
        allowed, retry_after = await asyncio.to_thread(
            _consume, rule, _hmac_key(f"ip:{_client_ip(request)}")
        )
    except Exception as exc:
        if os.getenv("NODE_ENV") == "production":
            raise HTTPException(status_code=503, detail="Webhook unavailable") from exc
        return
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many webhook requests",
            headers={"Retry-After": str(retry_after)},
        )
