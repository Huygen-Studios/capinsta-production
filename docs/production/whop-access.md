# Whop access

Capinsta keeps Supabase Auth. A signed-in user explicitly links Whop through
OAuth 2.1 PKCE at `/api/whop/link/start`. The callback obtains the Whop subject,
checks access to `WHOP_PRODUCT_ID` server-side, stores only stable identifiers,
grants the existing `clipper` product, and revokes the temporary refresh token.

`/api/webhooks/whop` verifies Standard Webhooks HMAC using the raw body,
timestamp tolerance, and `WHOP_WEBHOOK_SECRET`. `membership.activated` grants
and `membership.deactivated` revokes. Event IDs are idempotent; older events
cannot overwrite newer state. Full payloads and payment data are not stored.

Configure a Whop v1 webhook for membership activated/deactivated events. The
OAuth callback URL must exactly match
`https://<web-domain>/api/whop/link/callback`.
