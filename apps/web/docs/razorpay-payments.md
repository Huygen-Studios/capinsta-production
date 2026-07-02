# Donations and Private Server Requests

Capinsta uses Razorpay only for one-time donations.

Private Server is sales-assisted. The public price is indicative: `₹10,000/year`.
Visitors must submit a Private Server request so the team can confirm workload
requirements, availability, and onboarding. Private Server requests do not create
Razorpay objects, subscriptions, entitlements, credits, or provisioning jobs.

## Donation Environment

Server-only:

```env
PAYMENTS_ENABLED=true
PAYMENT_ENVIRONMENT=test
APP_URL=https://capinsta.huygenstudios.com
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
RAZORPAY_WEBHOOK_PREVIOUS_SECRET=
PAYMENT_SUPPORT_EMAIL=
DONATION_RECEIPTS_ENABLED=true
```

Only `RAZORPAY_KEY_ID` may be returned to the browser. Never expose
`RAZORPAY_KEY_SECRET`, webhook secrets, Supabase service-role keys, or internal
worker credentials with a `NEXT_PUBLIC_` prefix.

`PAYMENT_ENVIRONMENT` is enforced against the Razorpay Key ID prefix. Test
deployments must use `rzp_test_...` keys. Live deployments must use
`rzp_live_...` keys. A mismatched key mode makes checkout configuration
unavailable.

## Razorpay Dashboard

1. Use Test Mode first.
2. Create Test Mode API Key ID and Key Secret.
3. Configure webhook URL:
   - `https://YOUR_DOMAIN/api/webhooks/razorpay`
4. Set a webhook secret and copy it into `RAZORPAY_WEBHOOK_SECRET`.
5. Select donation events:
   - `payment.authorized`
   - `payment.captured`
   - `payment.failed`
   - `order.paid`
   - `refund.created`
   - `refund.processed`

Do not create a Razorpay Private Server plan. Do not configure Private Server
subscriptions in Razorpay.

## Private Server Requests

Apply migration:

```sql
apps/web/migrations/0009_private_server_requests.sql
```

The migration creates `private_server_requests`, enables RLS, revokes normal
anon/authenticated direct access, grants service-role access, and adds narrow
admin select/update policies through `public.capinsta_has_admin_role(NULL)`.

Public visitors submit requests through:

```http
POST /api/private-server/request
```

The API validates the payload server-side, requires consent, rate-limits the
request, rejects the honeypot field, attaches authenticated `user_id` only from
the server session, stores only a hashed IP, and returns a safe request ID.

Admins can review and update requests through service-role/admin workflows.
No public endpoint exposes request records.

## Test Mode Validation

Donations:

1. Set `PAYMENT_ENVIRONMENT=test`.
2. Set `PAYMENTS_ENABLED=true`.
3. Use Razorpay test credentials only.
4. Test each donation tier from `/donate`.
5. Confirm donation callback calls `/api/payments/donations/verify`.
6. Confirm donation webhook marks captured payments as paid.
7. Confirm donations do not create Private Server entitlements, subscriptions, credits, or provisioning jobs.

Private Server:

1. Open `/pricing`.
2. Confirm the card shows `₹10,000/year`.
3. Confirm the CTA says `Talk to Team`.
4. Submit the request form.
5. Confirm one row is inserted into `private_server_requests`.
6. Confirm no Razorpay order, subscription, entitlement, or provisioning job is created.

## Live Rollout

1. Repeat donation setup in Razorpay Live Mode.
2. Replace test keys with live keys.
3. Set `PAYMENT_ENVIRONMENT=live`.
4. Keep `RAZORPAY_WEBHOOK_PREVIOUS_SECRET` only during webhook secret rotation.
5. Deploy after the `private_server_requests` migration has run.

## Deprecated Subscription Cleanup

Historical `subscriptions`, `plan_entitlements`, and provisioning tables are kept
for compatibility and audit history. Active runtime flows no longer create
Razorpay subscriptions or provision Private Server resources automatically.

A later cleanup migration can remove historical subscription tables only after
production data has been audited and retained according to policy.

## Rollback

Set:

```env
PAYMENTS_ENABLED=false
```

Redeploy. New donation checkout creation is disabled. Private Server requests
remain available because they are not payment-dependent.
