import asyncio
import logging
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Request
from fastapi.responses import JSONResponse
from jwt import PyJWK

import server.auth as auth
import server.runtime_policy as policy
import server.main as main


def request(header: str | None = None) -> Request:
    headers = [] if header is None else [(b"authorization", header.encode())]
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/jobs",
            "headers": headers,
        }
    )


def hs_token(secret: str, **overrides):
    now = int(time.time())
    payload = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "iss": "https://example.supabase.co/auth/v1",
        "exp": now + 300,
        **overrides,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    auth._supabase_config.cache_clear()
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret-with-sufficient-entropy")
    monkeypatch.delenv("CAPINSTA_CONTROL_PLANE_REST_FALLBACK", raising=False)
    yield
    auth._supabase_config.cache_clear()


def test_missing_header_is_401():
    with pytest.raises(auth.MissingAuthorizationError) as error:
        auth.authenticate_request(request())
    assert error.value.status_code == 401


def test_empty_bearer_is_401():
    with pytest.raises(auth.MissingAuthorizationError):
        auth.authenticate_request(request("Bearer "))


@pytest.mark.parametrize(
    "token",
    ["not-a-jwt", jwt.encode({"sub": "x"}, "key", algorithm="HS384")],
)
def test_malformed_or_unsupported_token_is_401(token):
    with pytest.raises(auth.AuthBoundaryError) as error:
        auth.verify_access_token(token)
    assert error.value.status_code == 401


def test_expired_wrong_audience_and_wrong_issuer():
    cases = [
        (hs_token("test-secret-with-sufficient-entropy", exp=1), "token_expired"),
        (
            hs_token("test-secret-with-sufficient-entropy", aud="wrong"),
            "audience_invalid",
        ),
        (
            hs_token("test-secret-with-sufficient-entropy", iss="https://wrong/auth/v1"),
            "issuer_invalid",
        ),
    ]
    for token, reason in cases:
        with pytest.raises(auth.AuthBoundaryError) as error:
            auth.verify_access_token(token)
        assert error.value.reason == reason


def test_hmac_missing_secret_is_configuration_failure(monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET")
    auth._supabase_config.cache_clear()
    token = hs_token("another-secret")
    with pytest.raises(auth.AuthConfigurationError) as error:
        auth.verify_access_token(token)
    assert error.value.status_code == 503
    assert error.value.reason == "legacy_secret_missing"


def test_valid_hs256_token_authenticates():
    user_id = str(uuid.uuid4())
    user = auth.verify_access_token(
        hs_token("test-secret-with-sufficient-entropy", sub=user_id)
    )
    assert user.id == user_id


def test_valid_es256_token_through_jwks(monkeypatch):
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_jwk = jwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    public_jwk.update({"kid": "test-key", "alg": "ES256", "use": "sig"})
    token = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "aud": "authenticated",
            "iss": "https://example.supabase.co/auth/v1",
            "exp": int(time.time()) + 300,
        },
        private_key,
        algorithm="ES256",
        headers={"kid": "test-key"},
    )
    _, secret, client = auth._supabase_config()
    monkeypatch.setattr(
        client,
        "get_signing_key_from_jwt",
        lambda unused: PyJWK.from_dict(public_jwk),
    )
    assert secret
    assert auth.verify_access_token(token).id


def test_jwks_network_failure_is_503(monkeypatch):
    private_key = ec.generate_private_key(ec.SECP256R1())
    token = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "aud": "authenticated",
            "iss": "https://example.supabase.co/auth/v1",
            "exp": int(time.time()) + 300,
        },
        private_key,
        algorithm="ES256",
        headers={"kid": "missing"},
    )
    _, _, client = auth._supabase_config()
    monkeypatch.setattr(
        client,
        "get_signing_key_from_jwt",
        lambda unused: (_ for _ in ()).throw(
            auth.PyJWKClientConnectionError("temporary")
        ),
    )
    with pytest.raises(auth.SupabaseKeyUnavailableError) as error:
        auth.verify_access_token(token)
    assert error.value.status_code == 503


def test_active_suspended_and_missing_profile_repair(monkeypatch):
    user = auth.AuthenticatedUser(id=str(uuid.uuid4()))

    async def active_query(query, params=()):
        return ("active",)

    monkeypatch.setattr(policy, "_query_one", active_query)
    asyncio.run(policy.require_active_account(user))

    async def suspended_query(query, params=()):
        return ("suspended",)

    monkeypatch.setattr(policy, "_query_one", suspended_query)
    with pytest.raises(policy.InactiveAccountError):
        asyncio.run(policy.require_active_account(user))

    calls = iter([None, ("verified@example.invalid",), ("active",)])

    async def repair_query(query, params=()):
        return next(calls)

    writes = []

    async def repair_execute(query, params=()):
        writes.append(params)

    monkeypatch.setattr(policy, "_query_one", repair_query)
    monkeypatch.setattr(policy, "_execute", repair_execute)
    asyncio.run(policy.require_active_account(user))
    assert writes == [(user.id, "verified@example.invalid")]


def test_database_failure_is_control_plane_unavailable(monkeypatch):
    async def unavailable(query, params=()):
        raise policy.ControlPlaneUnavailableError()

    monkeypatch.setattr(policy, "_query_one", unavailable)
    with pytest.raises(policy.ControlPlaneUnavailableError):
        asyncio.run(
            policy.require_active_account(auth.AuthenticatedUser(id=str(uuid.uuid4())))
        )


def test_logs_never_contain_token_or_secret(caplog):
    token = "header.payload.signature-secret"
    with caplog.at_level(logging.WARNING):
        auth.log_auth_reject(
            auth.InvalidAccessTokenError(),
            request=request(f"Bearer {token}"),
            algorithm="ES256",
            key_id="kid",
            correlation_id="correlation",
        )
    text = caplog.text
    assert token not in text
    assert "test-secret-with-sufficient-entropy" not in text


def test_middleware_preserves_auth_status_categories(monkeypatch):
    authenticated = auth.AuthenticatedUser(id=str(uuid.uuid4()))

    async def call_next(unused):
        return JSONResponse({"ok": True})

    async def run_with(account_error=None, auth_error=None):
        if auth_error:
            monkeypatch.setattr(
                main,
                "authenticate_request",
                lambda unused: (_ for _ in ()).throw(auth_error),
            )
        else:
            monkeypatch.setattr(
                main, "authenticate_request", lambda unused: authenticated
            )

        async def account_check(unused):
            if account_error:
                raise account_error

        monkeypatch.setattr(main, "require_active_account", account_check)
        return await main.require_supabase_auth(
            request("Bearer safe-test-token"), call_next
        )

    assert asyncio.run(run_with(auth_error=auth.InvalidAccessTokenError())).status_code == 401
    assert asyncio.run(run_with(account_error=policy.InactiveAccountError())).status_code == 403
    assert (
        asyncio.run(run_with(account_error=policy.ControlPlaneUnavailableError())).status_code
        == 503
    )


def test_database_password_failure_has_safe_reason():
    class PasswordFailure(Exception):
        sqlstate = "28P01"

    error = policy.ControlPlaneUnavailableError()
    error.__cause__ = PasswordFailure()
    assert policy.control_plane_error_reason(error) == "database_authentication_failed"


def test_public_mode_backend_requires_approved_product_access(monkeypatch):
    user = auth.AuthenticatedUser(id=str(uuid.uuid4()))
    calls = iter([
        ("pending", None),
        ("public",),
    ])

    async def query_one(query, params=()):
        return next(calls)

    async def permissions(unused):
        return {"editor.access"}

    async def super_admin(unused):
        return False

    monkeypatch.setattr(policy, "_query_one", query_one)
    monkeypatch.setattr(policy, "effective_app_permissions", permissions)
    monkeypatch.setattr(policy, "is_super_admin", super_admin)

    with pytest.raises(policy.ProductAccessDeniedError) as error:
        asyncio.run(policy.require_backend_capability(user, "/api/media/assets"))
    assert error.value.reason == "product_access_pending"


def test_public_mode_backend_requires_exact_app_permission(monkeypatch):
    user = auth.AuthenticatedUser(id=str(uuid.uuid4()))
    calls = iter([
        ("approved", None),
        ("public",),
    ])

    async def query_one(query, params=()):
        return next(calls)

    async def permissions(unused):
        return {"editor.access"}

    async def super_admin(unused):
        return False

    monkeypatch.setattr(policy, "_query_one", query_one)
    monkeypatch.setattr(policy, "effective_app_permissions", permissions)
    monkeypatch.setattr(policy, "is_super_admin", super_admin)

    with pytest.raises(policy.ProductAccessDeniedError) as error:
        asyncio.run(policy.require_backend_capability(user, "/api/export/jobs"))
    assert error.value.reason == "missing_permission:exports.access"


def test_public_mode_backend_allows_approved_member_with_permission(monkeypatch):
    user = auth.AuthenticatedUser(id=str(uuid.uuid4()))
    calls = iter([
        ("approved", None),
        ("public",),
    ])

    async def query_one(query, params=()):
        return next(calls)

    async def permissions(unused):
        return {"editor.access"}

    async def super_admin(unused):
        return False

    monkeypatch.setattr(policy, "_query_one", query_one)
    monkeypatch.setattr(policy, "effective_app_permissions", permissions)
    monkeypatch.setattr(policy, "is_super_admin", super_admin)

    asyncio.run(policy.require_backend_capability(user, "/api/media/assets"))


def test_feature_disabled_and_quota_exceeded_keep_status(monkeypatch):
    async def disabled(key, default=True):
        return False

    monkeypatch.setattr(policy, "feature_enabled", disabled)
    with pytest.raises(Exception) as feature_error:
        asyncio.run(policy.require_feature("caption_generation_enabled", "disabled"))
    assert feature_error.value.status_code == 503

    async def limits(unused):
        return policy.UserLimits(daily_caption_minutes=0)

    async def used(unused_user, unused_metric):
        return 1

    monkeypatch.setattr(policy, "user_limits", limits)
    monkeypatch.setattr(policy, "_daily_usage", used)
    with pytest.raises(Exception) as quota_error:
        asyncio.run(policy.enforce_caption_quota(str(uuid.uuid4())))
    assert quota_error.value.status_code == 429
