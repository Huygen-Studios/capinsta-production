import base64
import hashlib
import hmac
import json

import pytest

from server.production.whop import (
    WhopWebhookError,
    parse_membership_event,
    verify_webhook,
)


def event(event_type: str = "membership.activated") -> bytes:
    return json.dumps(
        {
            "id": "msg_test_event",
            "type": event_type,
            "timestamp": "2026-07-27T12:00:00Z",
            "data": {
                "id": "mem_test_member",
                "user": {"id": "user_test_owner"},
                "product": {"id": "prod_capinsta"},
                "plan": {"id": "plan_beta"},
            },
        },
        separators=(",", ":"),
    ).encode()


def headers(body: bytes, secret: str = "test-secret"):
    timestamp = "1785153600"
    message = b"msg_test_event." + timestamp.encode() + b"." + body
    signature = base64.b64encode(
        hmac.new(secret.encode(), message, hashlib.sha256).digest()
    ).decode()
    return {
        "webhook-id": "msg_test_event",
        "webhook-timestamp": timestamp,
        "webhook-signature": f"v1,{signature}",
    }


def test_whop_signature_and_membership_contract():
    body = event()
    verify_webhook(body, headers(body), secret="test-secret", now=1785153600)
    encoded_secret = "whsec_" + base64.b64encode(b"test-secret").decode()
    verify_webhook(body, headers(body), secret=encoded_secret, now=1785153600)
    parsed = parse_membership_event(body, "prod_capinsta")
    assert parsed.whop_user_id == "user_test_owner"
    assert parsed.membership_id == "mem_test_member"
    assert parsed.payload_hash == hashlib.sha256(body).hexdigest()


def test_whop_rejects_tampering_stale_delivery_and_wrong_product():
    body = event()
    with pytest.raises(WhopWebhookError, match="invalid_signature"):
        verify_webhook(body + b" ", headers(body), secret="test-secret", now=1785153600)
    with pytest.raises(WhopWebhookError, match="stale_timestamp"):
        verify_webhook(body, headers(body), secret="test-secret", now=1785155000)
    with pytest.raises(WhopWebhookError, match="wrong_product"):
        parse_membership_event(body, "prod_other")
