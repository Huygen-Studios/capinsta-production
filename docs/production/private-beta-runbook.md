# Private-beta runbook

Onboard by creating the Supabase user, completing Whop OAuth linkage, and
confirming a `clipper.access` grant. Set `PRIVATE_BETA_MAX_USERS` before
enabling OAuth linking; administrators and the server-only allowlist may bypass
the cap. Start with one internal user, then a bounded
allowlist. Confirm upload, transcription, candidates, reframe, preview, MP4,
download, Capinsta edit/save, usage, signed-URL expiry, and cleanup visibility.

For incidents, set the relevant `DISABLE_*` flag first. Existing projects stay
readable. Use maintenance mode only for broad control-plane incidents. Record
request IDs rather than user content. Restore service by verifying readiness,
queue age, and one internal workflow before re-enabling admissions.

Account deletion requires a recent Supabase authentication timestamp. Ask the
user to sign in again rather than weakening this server-side check.
