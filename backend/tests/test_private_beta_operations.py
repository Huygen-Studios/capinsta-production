import asyncio

from starlette.requests import Request

from server.production.account_deletion import _objects
from server import rate_limit


class Cursor:
    def __init__(self):
        self.statement = ""

    async def execute(self, statement, _params):
        self.statement = statement

    async def fetchall(self):
        return [("media-variants", "owner/asset/proxy.mp4")]


def test_account_deletion_finds_variants_through_media_owner():
    cursor = Cursor()
    assert asyncio.run(_objects(cursor, "00000000-0000-0000-0000-000000000001"))
    assert "JOIN media_assets a ON a.id=v.media_asset_id" in cursor.statement


def test_whop_webhook_rate_limit_uses_trusted_proxy_ip(monkeypatch):
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/webhooks/whop",
            "headers": [(b"x-forwarded-for", b"203.0.113.8, 10.0.0.2")],
            "client": ("10.0.0.2", 1234),
        }
    )
    observed = {}
    monkeypatch.setenv("TRUSTED_PROXY_MODE", "coolify")
    monkeypatch.setattr(rate_limit, "_configured", lambda: True)

    def consume(rule, key):
        observed.update(name=rule.name, key=key)
        return True, 1

    monkeypatch.setattr(rate_limit, "_consume", consume)
    asyncio.run(rate_limit.enforce_whop_webhook_rate_limit(request))
    assert observed == {
        "name": "whop-webhook",
        "key": rate_limit._hmac_key("ip:203.0.113.8"),
    }
