import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin

import aiosqlite
import requests
from fastapi import HTTPException

from .auth import AuthenticatedUser
from .api_versioning import canonical_api_path
from .settings import DB_PATH

logger = logging.getLogger(__name__)

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None


@dataclass(frozen=True)
class UserLimits:
    daily_caption_minutes: int = 60
    daily_export_minutes: int = 60
    max_upload_duration_seconds: int = 1800
    max_concurrent_caption_jobs: int = 2
    max_concurrent_export_jobs: int = 1


class ControlPlaneUnavailableError(Exception):
    reason = "control_plane_unavailable"


class InactiveAccountError(Exception):
    reason = "profile_suspended"


class ProductAccessDeniedError(Exception):
    def __init__(self, reason: str, status_code: int = 403):
        self.reason = reason
        self.status_code = status_code
        super().__init__(reason)


def control_plane_error_reason(error: ControlPlaneUnavailableError) -> str:
    cause = error.__cause__
    if getattr(cause, "sqlstate", None) == "28P01":
        return "database_authentication_failed"
    return "control_plane_unavailable"


def database_url() -> str:
    return (os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()


def _allow_without_control_plane() -> bool:
    return os.getenv("NODE_ENV", "development") != "production"


def _rest_control_plane_enabled() -> bool:
    return (
        os.getenv("CAPINSTA_CONTROL_PLANE_REST_FALLBACK", "").strip().lower()
        in {"1", "true", "yes", "on"}
        and
        _allow_without_control_plane()
        and not database_url()
        and bool(os.getenv("SUPABASE_URL", "").strip())
        and bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip())
    )


def _rest_headers() -> dict[str, str]:
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    return {
        "apikey": key,
        "authorization": f"Bearer {key}",
        "accept": "application/json",
    }


def _rest_table_url(table: str) -> str:
    base = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    return urljoin(f"{base}/", f"rest/v1/{table}")


async def _rest_rows(table: str, params: dict[str, str]) -> list[dict]:
    def fetch() -> list[dict]:
        response = requests.get(
            _rest_table_url(table),
            headers=_rest_headers(),
            params=params,
            timeout=5,
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []

    try:
        return await asyncio.to_thread(fetch)
    except Exception as exc:
        logger.warning(
            "control_plane_rest_fallback_failed table=%s reason=%s",
            table,
            exc.__class__.__name__,
        )
        return []


def _not_expired(value: object) -> bool:
    if not value:
        return True
    if not isinstance(value, str):
        return True
    try:
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized) > datetime.now(timezone.utc)
    except ValueError:
        return True


async def _rest_profile(user_id: str, select: str) -> dict | None:
    rows = await _rest_rows(
        "profiles",
        {"select": select, "user_id": f"eq.{user_id}", "limit": "1"},
    )
    return rows[0] if rows else None


async def _rest_site_mode() -> str:
    rows = await _rest_rows(
        "site_access_policy",
        {"select": "mode", "id": "eq.global", "limit": "1"},
    )
    return str(rows[0].get("mode") or "public") if rows else "public"


def _in_filter(values: list[str]) -> str:
    return f"in.({','.join(values)})"


async def _rest_effective_app_permissions(user_id: str) -> set[str]:
    memberships = await _rest_rows(
        "app_role_members",
        {
            "select": "role_id,expires_at",
            "user_id": f"eq.{user_id}",
            "active": "eq.true",
        },
    )
    role_ids = [
        str(row.get("role_id"))
        for row in memberships
        if row.get("role_id") and _not_expired(row.get("expires_at"))
    ]
    permission_ids: set[str] = set()
    if role_ids:
        role_permissions = await _rest_rows(
            "app_role_permissions",
            {"select": "permission_id", "role_id": _in_filter(role_ids)},
        )
        permission_ids.update(
            str(row.get("permission_id"))
            for row in role_permissions
            if row.get("permission_id")
        )
    overrides = await _rest_rows(
        "app_user_permission_overrides",
        {
            "select": "permission_id,effect,expires_at",
            "user_id": f"eq.{user_id}",
            "active": "eq.true",
        },
    )
    denied_ids: set[str] = set()
    for row in overrides:
        permission_id = row.get("permission_id")
        if not permission_id or not _not_expired(row.get("expires_at")):
            continue
        if row.get("effect") == "allow":
            permission_ids.add(str(permission_id))
        elif row.get("effect") == "deny":
            denied_ids.add(str(permission_id))
    permission_ids.difference_update(denied_ids)
    if not permission_ids:
        return set()
    permissions = await _rest_rows(
        "app_permissions",
        {"select": "id,key", "id": _in_filter(sorted(permission_ids))},
    )
    return {str(row.get("key")) for row in permissions if row.get("key")}


async def _rest_is_super_admin(user_id: str) -> bool:
    memberships = await _rest_rows(
        "admin_role_members",
        {
            "select": "role_id,expires_at",
            "user_id": f"eq.{user_id}",
            "active": "eq.true",
        },
    )
    role_ids = [
        str(row.get("role_id"))
        for row in memberships
        if row.get("role_id") and _not_expired(row.get("expires_at"))
    ]
    if not role_ids:
        return False
    roles = await _rest_rows(
        "admin_roles",
        {"select": "id,key", "id": _in_filter(role_ids), "key": "eq.super_admin"},
    )
    return bool(roles)


async def _query_one(query: str, params: tuple = ()):
    url = database_url()
    if not url or psycopg is None:
        if _allow_without_control_plane():
            return None
        raise ControlPlaneUnavailableError()
    try:
        async with await psycopg.AsyncConnection.connect(url, connect_timeout=3) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(query, params)
                return await cursor.fetchone()
    except HTTPException:
        raise
    except Exception as exc:
        if _allow_without_control_plane():
            return None
        raise ControlPlaneUnavailableError() from exc


async def require_active_account(user: AuthenticatedUser) -> None:
    if _rest_control_plane_enabled():
        row = await _rest_profile(user.id, "account_status")
        if not row or row.get("account_status") != "active":
            raise InactiveAccountError()
        return

    row = await _query_one(
        "SELECT account_status FROM profiles WHERE user_id = %s::uuid",
        (user.id,),
    )
    if row is None:
        auth_user = await _query_one(
            "SELECT email FROM auth.users WHERE id = %s::uuid",
            (user.id,),
        )
        if auth_user is None:
            raise InactiveAccountError()
        await _execute(
            """
            INSERT INTO profiles (user_id, email_snapshot)
            VALUES (%s::uuid, %s)
            ON CONFLICT (user_id) DO UPDATE
              SET email_snapshot = COALESCE(profiles.email_snapshot, EXCLUDED.email_snapshot),
                  updated_at = now()
            """,
            (user.id, auth_user[0]),
        )
        row = await _query_one(
            "SELECT account_status FROM profiles WHERE user_id = %s::uuid",
            (user.id,),
        )
    if row is None or row[0] != "active":
        raise InactiveAccountError()


def _permission_for_path(path: str) -> str:
    path = canonical_api_path(path)
    if path.startswith("/api/projects"):
        return "projects.access"
    if path.startswith("/api/export/jobs"):
        return "exports.access"
    if path.startswith("/api/jobs") or path.startswith("/api/captions/jobs") or path.startswith("/api/media/assets"):
        return "editor.access"
    return "app.access"


async def effective_app_permissions(user_id: str) -> set[str]:
    if _rest_control_plane_enabled():
        return await _rest_effective_app_permissions(user_id)

    rows = await _query_all(
        """
        SELECT p.key
        FROM app_role_members m
        JOIN app_role_permissions rp ON rp.role_id = m.role_id
        JOIN app_permissions p ON p.id = rp.permission_id
        WHERE m.user_id = %s::uuid
          AND m.active = true
          AND (m.expires_at IS NULL OR m.expires_at > now())
        UNION
        SELECT p.key
        FROM app_user_permission_overrides o
        JOIN app_permissions p ON p.id = o.permission_id
        WHERE o.user_id = %s::uuid
          AND o.active = true
          AND o.effect = 'allow'
          AND (o.expires_at IS NULL OR o.expires_at > now())
        EXCEPT
        SELECT p.key
        FROM app_user_permission_overrides o
        JOIN app_permissions p ON p.id = o.permission_id
        WHERE o.user_id = %s::uuid
          AND o.active = true
          AND o.effect = 'deny'
          AND (o.expires_at IS NULL OR o.expires_at > now())
        """,
        (user_id, user_id, user_id),
    )
    return {str(row[0]) for row in rows}


async def is_super_admin(user_id: str) -> bool:
    if _rest_control_plane_enabled():
        profile = await _rest_profile(user_id, "account_status")
        if not profile or profile.get("account_status") != "active":
            return False
        return await _rest_is_super_admin(user_id)

    row = await _query_one(
        """
        SELECT 1
        FROM admin_role_members m
        JOIN admin_roles r ON r.id = m.role_id
        JOIN profiles p ON p.user_id = m.user_id
        WHERE m.user_id = %s::uuid
          AND m.active = true
          AND r.key = 'super_admin'
          AND p.account_status = 'active'
        LIMIT 1
        """,
        (user_id,),
    )
    return row is not None


async def require_backend_capability(user: AuthenticatedUser, request_path: str) -> None:
    if _rest_control_plane_enabled():
        profile = await _rest_profile(
            user.id,
            "product_access_status,product_access_expires_at",
        )
        row = (
            (
                profile.get("product_access_status"),
                profile.get("product_access_expires_at"),
            )
            if profile
            else None
        )
    else:
        row = await _query_one(
            """
            SELECT product_access_status, product_access_expires_at
            FROM profiles
            WHERE user_id = %s::uuid
            """,
            (user.id,),
        )
    if row is None:
        raise ProductAccessDeniedError("product_access_pending")
    product_status = row[0]
    expires_at = row[1]
    if product_status == "revoked":
        raise ProductAccessDeniedError("product_access_revoked")
    if expires_at is not None:
        expired = await _query_one("SELECT %s::timestamptz <= now()", (expires_at,))
        if expired and bool(expired[0]):
            raise ProductAccessDeniedError("product_access_expired")

    if _rest_control_plane_enabled():
        mode = await _rest_site_mode()
    else:
        policy = await _query_one(
            "SELECT mode FROM site_access_policy WHERE id = 'global'",
        )
        mode = "public" if policy is None else str(policy[0])
    permission = _permission_for_path(request_path)
    permissions = await effective_app_permissions(user.id)
    super_admin = await is_super_admin(user.id)

    if super_admin:
        logger.info(
            "auth_allow user_id=%s path=%s permission=%s product_status=%s admin=super_admin",
            user.id,
            request_path,
            permission,
            product_status,
        )
        return
    if mode == "maintenance":
        if "maintenance.bypass" in permissions:
            logger.info(
                "auth_allow user_id=%s path=%s permission=%s product_status=%s reason=maintenance_bypass",
                user.id,
                request_path,
                permission,
                product_status,
            )
            return
        raise ProductAccessDeniedError("maintenance_mode", 503)
    if mode not in {"public", "coming_soon"}:
        raise ProductAccessDeniedError("control_plane_unavailable", 503)
    if product_status != "approved":
        raise ProductAccessDeniedError("product_access_pending")
    if permission not in permissions:
        raise ProductAccessDeniedError(f"missing_permission:{permission}")
    logger.info(
        "auth_allow user_id=%s path=%s permission=%s product_status=%s",
        user.id,
        request_path,
        permission,
        product_status,
    )


async def _execute(query: str, params: tuple = ()) -> None:
    url = database_url()
    if not url or psycopg is None:
        raise ControlPlaneUnavailableError()
    try:
        async with await psycopg.AsyncConnection.connect(
            url, connect_timeout=3
        ) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(query, params)
            await connection.commit()
    except Exception as exc:
        raise ControlPlaneUnavailableError() from exc


async def _query_all(query: str, params: tuple = ()):
    url = database_url()
    if not url or psycopg is None:
        if _allow_without_control_plane():
            return []
        raise ControlPlaneUnavailableError()
    try:
        async with await psycopg.AsyncConnection.connect(url, connect_timeout=3) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(query, params)
                return await cursor.fetchall()
    except Exception as exc:
        if _allow_without_control_plane():
            return []
        raise ControlPlaneUnavailableError() from exc


async def control_plane_health() -> dict[str, str]:
    try:
        row = await _query_one(
            """
            SELECT
              to_regclass('public.profiles') IS NOT NULL,
              to_regclass('public.feature_flags') IS NOT NULL,
              to_regclass('public.system_settings') IS NOT NULL,
              to_regclass('public.user_quotas') IS NOT NULL,
              (SELECT enabled FROM feature_flags WHERE key = 'caption_generation_enabled')
            """
        )
        healthy = bool(row and all(row[:4]) and isinstance(row[4], bool))
        return {"controlPlaneDatabase": "healthy" if healthy else "unavailable"}
    except ControlPlaneUnavailableError:
        return {"controlPlaneDatabase": "unavailable"}


async def feature_enabled(key: str, default: bool = True) -> bool:
    if _rest_control_plane_enabled():
        rows = await _rest_rows(
            "feature_flags",
            {"select": "enabled", "key": f"eq.{key}", "limit": "1"},
        )
        return default if not rows else bool(rows[0].get("enabled"))

    row = await _query_one("SELECT enabled FROM feature_flags WHERE key = %s", (key,))
    return default if row is None else bool(row[0])


async def system_int(key: str, default: int, minimum: int, maximum: int) -> int:
    if _rest_control_plane_enabled():
        rows = await _rest_rows(
            "system_settings",
            {"select": "value", "key": f"eq.{key}", "limit": "1"},
        )
        if not rows:
            return default
        try:
            return max(minimum, min(maximum, int(rows[0].get("value"))))
        except (TypeError, ValueError):
            return default

    row = await _query_one("SELECT value FROM system_settings WHERE key = %s", (key,))
    if row is None:
        return default
    try:
        value = int(row[0])
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


async def require_feature(key: str, message: str) -> None:
    if not await feature_enabled(key):
        raise HTTPException(status_code=503, detail=message)
    if key != "maintenance_mode" and await feature_enabled("maintenance_mode", False):
        raise HTTPException(status_code=503, detail="Capinsta is temporarily in maintenance mode.")


async def require_provider_enabled(provider: str) -> None:
    if provider in {"", "auto"}:
        return
    if _rest_control_plane_enabled():
        rows = await _rest_rows(
            "feature_flags",
            {
                "select": "configuration",
                "key": "eq.provider_controls",
                "limit": "1",
            },
        )
        config = rows[0].get("configuration") if rows else None
        if isinstance(config, dict) and config.get(provider) is False:
            raise HTTPException(status_code=503, detail="The configured transcription provider is temporarily unavailable.")
        return

    row = await _query_one(
        "SELECT COALESCE((configuration ->> %s)::boolean, true) FROM feature_flags WHERE key = 'provider_controls'",
        (provider,),
    )
    if row is not None and not bool(row[0]):
        raise HTTPException(status_code=503, detail="The configured transcription provider is temporarily unavailable.")


async def user_limits(user_id: str) -> UserLimits:
    if _rest_control_plane_enabled():
        rows = await _rest_rows(
            "user_quotas",
            {
                "select": "daily_caption_minutes,daily_export_minutes,max_upload_duration_seconds,max_concurrent_caption_jobs,max_concurrent_export_jobs",
                "user_id": f"eq.{user_id}",
                "limit": "1",
            },
        )
        if rows:
            row = rows[0]
            return UserLimits(
                daily_caption_minutes=int(row.get("daily_caption_minutes") or 60),
                daily_export_minutes=int(row.get("daily_export_minutes") or 60),
                max_upload_duration_seconds=int(
                    row.get("max_upload_duration_seconds") or 1800
                ),
                max_concurrent_caption_jobs=int(
                    row.get("max_concurrent_caption_jobs") or 2
                ),
                max_concurrent_export_jobs=int(
                    row.get("max_concurrent_export_jobs") or 1
                ),
            )
        defaults = await asyncio.gather(
            system_int("daily_caption_minutes", 60, 0, 100000),
            system_int("daily_export_minutes", 60, 0, 100000),
            system_int("maximum_upload_duration_seconds", 1800, 1, 86400),
            system_int("maximum_concurrent_caption_jobs", 2, 1, 100),
            system_int("maximum_concurrent_export_jobs", 1, 1, 100),
        )
        return UserLimits(*defaults)

    row = await _query_one(
        """
        SELECT daily_caption_minutes, daily_export_minutes,
               max_upload_duration_seconds, max_concurrent_caption_jobs,
               max_concurrent_export_jobs
        FROM user_quotas WHERE user_id = %s::uuid
        """,
        (user_id,),
    )
    if row is not None:
        return UserLimits(*map(int, row))
    defaults = await asyncio.gather(
        system_int("daily_caption_minutes", 60, 0, 100000),
        system_int("daily_export_minutes", 60, 0, 100000),
        system_int("maximum_upload_duration_seconds", 1800, 1, 86400),
        system_int("maximum_concurrent_caption_jobs", 2, 1, 100),
        system_int("maximum_concurrent_export_jobs", 1, 1, 100),
    )
    return UserLimits(*defaults)


async def _daily_usage(user_id: str, metric: str) -> float:
    if _rest_control_plane_enabled():
        return 0.0

    row = await _query_one(
        """
        SELECT COALESCE(sum(numeric_value), 0)
        FROM usage_events
        WHERE user_id = %s::uuid
          AND event_type = %s
          AND occurred_at >= CURRENT_DATE
          AND occurred_at < CURRENT_DATE + INTERVAL '1 day'
        """,
        (user_id, metric),
    )
    return 0.0 if row is None else float(row[0] or 0)


async def enforce_caption_quota(user_id: str, requested_seconds: float | None = None) -> UserLimits:
    limits = await user_limits(user_id)
    if requested_seconds and requested_seconds > limits.max_upload_duration_seconds:
        raise HTTPException(status_code=413, detail="Media duration exceeds your current limit.")
    used = await _daily_usage(user_id, "caption_minutes")
    requested_minutes = max(0.0, float(requested_seconds or 0) / 60)
    if used + requested_minutes > limits.daily_caption_minutes:
        raise HTTPException(status_code=429, detail="Daily caption quota reached.")
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "SELECT count(*) FROM jobs WHERE user_id = ? AND status NOT IN ('completed','failed','cancelled','expired','closed')",
            (user_id,),
        )
        active = int((await cursor.fetchone())[0])
    if active >= limits.max_concurrent_caption_jobs:
        raise HTTPException(status_code=429, detail="Concurrent caption-job limit reached.")
    return limits


async def enforce_export_quota(user_id: str, requested_seconds: float) -> UserLimits:
    limits = await user_limits(user_id)
    used = await _daily_usage(user_id, "export_minutes")
    if used + max(0.0, requested_seconds / 60) > limits.daily_export_minutes:
        raise HTTPException(status_code=429, detail="Daily export quota reached.")
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "SELECT count(*) FROM export_jobs WHERE user_id = ? AND status IN ('queued','running')",
            (user_id,),
        )
        active = int((await cursor.fetchone())[0])
    if active >= limits.max_concurrent_export_jobs:
        raise HTTPException(status_code=429, detail="Concurrent export-job limit reached.")
    global_limit = await system_int("global_export_concurrency", 1, 1, 1000)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "SELECT count(*) FROM export_jobs WHERE status IN ('queued','running')"
        )
        globally_active = int((await cursor.fetchone())[0])
    if globally_active >= global_limit:
        raise HTTPException(status_code=429, detail="Global export capacity is currently full.")
    return limits


async def project_retention_state(project_id: str) -> tuple[bool, str | None]:
    row = await _query_one(
        "SELECT retention_hold, expires_at::text FROM project_registry WHERE project_id = %s",
        (project_id,),
    )
    return (False, None) if row is None else (bool(row[0]), row[1])
