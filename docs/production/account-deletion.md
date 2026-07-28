# Account deletion

An authenticated user posts the exact confirmation `DELETE MY ACCOUNT` to
`/api/account/deletion`. CSRF protection applies. The request immediately marks
the account unavailable, revokes entitlements, and requests cancellation of
active durable jobs.

The current flow uses the verified Supabase session, same-origin CSRF check,
and explicit confirmation phrase. A separate recent-login challenge is not yet
implemented and remains a private-beta launch limitation.

The scheduled deletion processor removes recorded private Storage objects,
removes product/Whop/reservation records, anonymizes retained usage, and
deletes the Supabase Auth user last. The Auth foreign-key cascade removes the
remaining account-owned rows, including the deletion request. It is idempotent
and bounded; failures before Auth deletion retain a safe code for retry. GET on
the same endpoint returns user-visible status while the session remains valid.

This is an implemented deletion workflow, not a claim of regulatory
certification.
