import logging
import os
from contextvars import ContextVar
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import urlparse

import jwt
from fastapi import Request
from jwt import PyJWKClient
from jwt.exceptions import (
    DecodeError,
    ExpiredSignatureError,
    InvalidAudienceError,
    InvalidIssuerError,
    InvalidSignatureError,
    InvalidTokenError,
    PyJWKClientConnectionError,
    PyJWKClientError,
)

logger = logging.getLogger(__name__)
ALLOWED_JWT_ALGORITHMS = frozenset({"HS256", "RS256", "ES256"})
LOCAL_DEVELOPMENT_USER_ID = "00000000-0000-4000-8000-000000000001"


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str | None = None


class AuthBoundaryError(Exception):
    status_code = 401
    reason = "invalid_token"
    public_detail = "Unauthorized"
    public_code = "invalid_token"


class MissingAuthorizationError(AuthBoundaryError):
    reason = "missing_bearer"
    public_code = "missing_bearer"


class MalformedAuthorizationError(AuthBoundaryError):
    reason = "malformed_authorization"
    public_code = "malformed_authorization"


class InvalidAccessTokenError(AuthBoundaryError):
    pass


class ExpiredAccessTokenError(AuthBoundaryError):
    reason = "token_expired"
    public_code = "token_expired"


class SupabaseKeyUnavailableError(AuthBoundaryError):
    status_code = 503
    reason = "jwks_fetch_failed"
    public_detail = "Authentication service temporarily unavailable"
    public_code = "auth_service_unavailable"


class AuthConfigurationError(AuthBoundaryError):
    status_code = 503
    reason = "auth_configuration_invalid"
    public_detail = "Authentication service unavailable"
    public_code = "auth_configuration_invalid"


_current_user: ContextVar[AuthenticatedUser | None] = ContextVar(
    "current_user", default=None
)
_auth_health: dict[str, str] = {
    "supabaseAuth": "unknown",
    "jwtMode": "unknown",
}


def _safe_supabase_hostname() -> str:
    return urlparse((os.getenv("SUPABASE_URL") or "").strip()).hostname or "unknown"


def local_development_access_enabled() -> bool:
    """Unsafe local-only switch. It never enables production authentication."""
    return (
        os.getenv("NODE_ENV", "development") != "production"
        and os.getenv("ENABLE_LOCAL_DEVELOPMENT_ACCESS", "false").strip().lower()
        in {"1", "true", "yes", "on"}
    )


def _is_loopback_request(request: Request) -> bool:
    return request.client is not None and request.client.host in {"127.0.0.1", "::1"}


def log_auth_reject(
    error: AuthBoundaryError,
    *,
    request: Request | None = None,
    algorithm: str | None = None,
    key_id: str | None = None,
    correlation_id: str | None = None,
) -> None:
    logger.warning(
        "auth_reject reason=%s method=%s path=%s correlation_id=%s alg=%s kid=%s supabase_host=%s",
        error.reason,
        request.method if request else "-",
        request.url.path if request else "-",
        correlation_id or "-",
        algorithm or "-",
        (key_id or "-")[:80],
        _safe_supabase_hostname(),
    )


def request_token_metadata(request: Request) -> tuple[str | None, str | None]:
    authorization = request.headers.get("authorization") or ""
    _, _, token = authorization.partition(" ")
    if not token:
        return None, None
    try:
        header = jwt.get_unverified_header(token.strip())
    except InvalidTokenError:
        return None, None
    algorithm = header.get("alg")
    key_id = header.get("kid")
    return (
        algorithm if isinstance(algorithm, str) else None,
        key_id if isinstance(key_id, str) else None,
    )


@lru_cache(maxsize=1)
def _supabase_config() -> tuple[str, str | None, PyJWKClient]:
    url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    parsed = urlparse(url)
    if (
        not url
        or parsed.scheme != "https"
        or not parsed.hostname
        or not parsed.hostname.endswith(".supabase.co")
    ):
        raise AuthConfigurationError()
    secret = (os.getenv("SUPABASE_JWT_SECRET") or "").strip() or None
    return (
        url,
        secret,
        PyJWKClient(
            f"{url}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
            cache_jwk_set=True,
            lifespan=600,
            timeout=5,
        ),
    )


def _token_header(token: str) -> tuple[str, str | None]:
    try:
        header = jwt.get_unverified_header(token)
    except (DecodeError, InvalidTokenError) as exc:
        error = InvalidAccessTokenError()
        error.reason = "malformed_jwt"
        raise error from exc
    algorithm = str(header.get("alg") or "")
    key_id = header.get("kid")
    if algorithm not in ALLOWED_JWT_ALGORITHMS:
        error = InvalidAccessTokenError()
        error.reason = "unsupported_algorithm"
        raise error
    return algorithm, key_id if isinstance(key_id, str) else None


def verify_access_token(token: str) -> AuthenticatedUser:
    algorithm, _ = _token_header(token)
    try:
        url, legacy_secret, jwks = _supabase_config()
        if algorithm == "HS256":
            _auth_health["jwtMode"] = "legacy_hmac"
            if not legacy_secret:
                error = AuthConfigurationError()
                error.reason = "legacy_secret_missing"
                raise error
            key = legacy_secret
        else:
            _auth_health["jwtMode"] = "jwks"
            key = jwks.get_signing_key_from_jwt(token).key

        payload = jwt.decode(
            token,
            key,
            algorithms=[algorithm],
            audience="authenticated",
            issuer=f"{url}/auth/v1",
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
        user_id = payload.get("sub")
        if not isinstance(user_id, str) or not user_id:
            error = InvalidAccessTokenError()
            error.reason = "subject_missing"
            raise error
        email = payload.get("email")
        _auth_health["supabaseAuth"] = "healthy"
        return AuthenticatedUser(
            id=user_id,
            email=email if isinstance(email, str) else None,
        )
    except AuthBoundaryError:
        raise
    except ExpiredSignatureError as exc:
        raise ExpiredAccessTokenError() from exc
    except InvalidAudienceError as exc:
        error = InvalidAccessTokenError()
        error.reason = "audience_invalid"
        raise error from exc
    except InvalidIssuerError as exc:
        error = InvalidAccessTokenError()
        error.reason = "issuer_invalid"
        raise error from exc
    except InvalidSignatureError as exc:
        error = InvalidAccessTokenError()
        error.reason = "signature_invalid"
        raise error from exc
    except PyJWKClientConnectionError as exc:
        _auth_health["supabaseAuth"] = "unavailable"
        raise SupabaseKeyUnavailableError() from exc
    except PyJWKClientError as exc:
        error = InvalidAccessTokenError()
        error.reason = "signing_key_invalid"
        raise error from exc
    except InvalidTokenError as exc:
        raise InvalidAccessTokenError() from exc
    except Exception as exc:
        logger.exception("auth_verification_unexpected category=%s", type(exc).__name__)
        error = AuthBoundaryError()
        error.status_code = 500
        error.reason = "unexpected"
        error.public_detail = "Internal authentication error"
        error.public_code = "auth_internal_error"
        raise error from exc


def authenticate_request(request: Request) -> AuthenticatedUser:
    authorization = request.headers.get("authorization")
    if authorization is None:
        if local_development_access_enabled() and _is_loopback_request(request):
            return AuthenticatedUser(
                id=LOCAL_DEVELOPMENT_USER_ID,
                email="local-clipper@capinsta.invalid",
            )
        raise MissingAuthorizationError()
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator:
        raise MalformedAuthorizationError()
    token = token.strip()
    if not token:
        raise MissingAuthorizationError()
    return verify_access_token(token)


def auth_health_status() -> dict[str, str]:
    return dict(_auth_health)


def validate_auth_startup() -> dict[str, str]:
    if local_development_access_enabled():
        _auth_health.update(supabaseAuth="local_development", jwtMode="local_only")
        return auth_health_status()
    url, legacy_secret, jwks = _supabase_config()
    try:
        jwk_set = jwks.get_jwk_set(refresh=True)
        keys = list(jwk_set.keys)
    except PyJWKClientConnectionError as exc:
        _auth_health.update(supabaseAuth="unavailable", jwtMode="jwks")
        raise SupabaseKeyUnavailableError() from exc
    if keys:
        algorithms = {str(key.algorithm_name) for key in keys}
        if not algorithms.intersection({"RS256", "ES256"}):
            raise AuthConfigurationError()
        _auth_health.update(supabaseAuth="healthy", jwtMode="jwks")
    elif legacy_secret:
        _auth_health.update(supabaseAuth="healthy", jwtMode="legacy_hmac")
    else:
        error = AuthConfigurationError()
        error.reason = "legacy_secret_missing"
        raise error
    logger.info(
        "supabase_auth_status status=%s mode=%s host=%s",
        _auth_health["supabaseAuth"],
        _auth_health["jwtMode"],
        urlparse(url).hostname,
    )
    return auth_health_status()


def set_current_user(user: AuthenticatedUser):
    return _current_user.set(user)


def reset_current_user(token) -> None:
    _current_user.reset(token)


def current_user() -> AuthenticatedUser:
    user = _current_user.get()
    if user is None:
        raise MissingAuthorizationError()
    return user


async def get_owned_job(db, job_id: str):
    user = current_user()
    cursor = await db.execute(
        "SELECT * FROM jobs WHERE id = ? AND user_id = ?",
        (job_id, user.id),
    )
    row = await cursor.fetchone()
    if not row:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Job not found")
    return row
