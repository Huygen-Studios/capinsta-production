import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass

from fastapi import HTTPException, Request
import requests

try:
    import psycopg
except ImportError:  # pragma: no cover - startup health reports missing dependency.
    psycopg = None


@dataclass(frozen=True)
class BackendAdmin:
    user_id: str
    permission: str
    correlation_id: str
    assertion_id: str


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

def _admin_is_currently_authorized(user_id: str, permission: str) -> bool:
    database_url = (os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()
    if not database_url or psycopg is None:
        return False
    query = """
        SELECT EXISTS (
          SELECT 1
          FROM profiles p
          JOIN admin_role_members m ON m.user_id = p.user_id AND m.active = true
          JOIN admin_role_permissions rp ON rp.role_id = m.role_id
          JOIN admin_permissions ap ON ap.id = rp.permission_id
          WHERE p.user_id = %s::uuid
            AND p.account_status = 'active'
            AND ap.key = %s
        )
    """
    try:
        with psycopg.connect(database_url, connect_timeout=3) as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, (user_id, permission))
                row = cursor.fetchone()
                return bool(row and row[0])
    except Exception:
        return False


def _consume_assertion_once(assertion_id: str, ttl_seconds: int) -> bool:
    url = (os.getenv("UPSTASH_REDIS_REST_URL") or "").rstrip("/")
    token = (os.getenv("UPSTASH_REDIS_REST_TOKEN") or "").strip()
    if not url or not token:
        return False
    key = f"admin-assertion-used:{assertion_id}"
    try:
        response = requests.post(
            f"{url}/set/{key}/1/NX/EX/{max(1, ttl_seconds)}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=3,
        )
        response.raise_for_status()
        return response.json().get("result") == "OK"
    except Exception:
        return False


def require_backend_admin_permission(request: Request, permission: str) -> BackendAdmin:
    secret = (os.getenv("INTERNAL_ADMIN_API_SECRET") or "").encode()
    if len(secret) < 32:
        raise HTTPException(status_code=503, detail="Admin service unavailable")
    assertion = request.headers.get("x-capinsta-admin-assertion", "")
    payload_part, separator, signature_part = assertion.partition(".")
    if not separator:
        raise HTTPException(status_code=401, detail="Unauthorized")
    expected = hmac.new(secret, payload_part.encode(), hashlib.sha256).digest()
    try:
        signature = _decode(signature_part)
        payload = json.loads(_decode(payload_part))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Unauthorized") from exc
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Unauthorized")
    now = time.time()
    expected_issuer = os.getenv("ADMIN_ASSERTION_ISSUER", "capinsta-web")
    assertion_id = payload.get("jti")
    if (
        payload.get("iss") != expected_issuer
        or
        payload.get("aud") != "capinsta-fastapi-admin"
        or payload.get("aal") != "aal2"
        or payload.get("permission") != permission
        or payload.get("method") != request.method.upper()
        or payload.get("path") != request.url.path
        or not isinstance(payload.get("sub"), str)
        or not isinstance(assertion_id, str)
        or not isinstance(payload.get("iat"), (int, float))
        or not isinstance(payload.get("nbf"), (int, float))
        or not isinstance(payload.get("exp"), (int, float))
        or payload["iat"] > now + 5
        or payload["nbf"] > now
        or payload["exp"] < now
        or payload["exp"] > now + 60
    ):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not _admin_is_currently_authorized(payload["sub"], permission):
        raise HTTPException(status_code=403, detail="Forbidden")
    if request.method.upper() not in {"GET", "HEAD", "OPTIONS"}:
        ttl = max(1, int(payload["exp"] - now) + 5)
        if not _consume_assertion_once(assertion_id, ttl):
            raise HTTPException(status_code=409, detail="Assertion already used")
    correlation_id = request.headers.get("x-correlation-id") or payload.get("correlation_id")
    if not isinstance(correlation_id, str) or not correlation_id:
        raise HTTPException(status_code=400, detail="Missing correlation ID")
    return BackendAdmin(
        user_id=payload["sub"],
        permission=permission,
        correlation_id=correlation_id,
        assertion_id=assertion_id,
    )
