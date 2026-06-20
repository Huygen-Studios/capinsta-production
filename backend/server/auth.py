import os
from contextvars import ContextVar
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str | None = None


_current_user: ContextVar[AuthenticatedUser | None] = ContextVar("current_user", default=None)


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail="Unauthorized")


@lru_cache(maxsize=1)
def _supabase_config() -> tuple[str, str | None, PyJWKClient]:
    url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    if not url:
        raise RuntimeError("SUPABASE_URL is required for protected API routes.")
    secret = (os.getenv("SUPABASE_JWT_SECRET") or "").strip() or None
    return url, secret, PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json")


def verify_access_token(token: str) -> AuthenticatedUser:
    try:
        url, legacy_secret, jwks = _supabase_config()
        header = jwt.get_unverified_header(token)
        algorithm = str(header.get("alg") or "")
        if algorithm.startswith("HS"):
            if not legacy_secret:
                raise _unauthorized()
            key = legacy_secret
        else:
            key = jwks.get_signing_key_from_jwt(token).key
        payload = jwt.decode(
            token,
            key,
            algorithms=[algorithm],
            audience="authenticated",
            issuer=f"{url}/auth/v1",
        )
        user_id = payload.get("sub")
        if not isinstance(user_id, str) or not user_id:
            raise _unauthorized()
        email = payload.get("email")
        return AuthenticatedUser(
            id=user_id,
            email=email if isinstance(email, str) else None,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _unauthorized() from exc


def authenticate_request(request: Request) -> AuthenticatedUser:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()
    return verify_access_token(token)


def set_current_user(user: AuthenticatedUser):
    return _current_user.set(user)


def reset_current_user(token) -> None:
    _current_user.reset(token)


def current_user() -> AuthenticatedUser:
    user = _current_user.get()
    if user is None:
        raise _unauthorized()
    return user


async def get_owned_job(db, job_id: str):
    user = current_user()
    cursor = await db.execute(
        "SELECT * FROM jobs WHERE id = ? AND user_id = ?",
        (job_id, user.id),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return row
