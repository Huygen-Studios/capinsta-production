# Launch Access Control Deployment

## Deployment Order

1. Back up the production database.
2. Apply `apps/web/migrations/0003_launch_access_control.sql`.
3. Confirm existing owner and recovery administrator profiles have `product_access_status = 'approved'`.
4. Confirm `site_access_policy.id = 'global'` is seeded with `mode = 'public'`.
5. Deploy the backend access-policy code.
6. Verify backend `/health` and direct authenticated API behavior for approved, pending, revoked and maintenance-bypass accounts.
7. Deploy the frontend.
8. Verify owner admin login, AAL2 MFA, `/admincapinsta11/access-control`, public mode, an existing approved account and a new pending test account.
9. From `/admincapinsta11/access-control`, switch to `coming_soon` with a written reason.
10. Verify public root, Google signup, email signup, pending `/early-access`, approved-user product access and direct backend denial for pending users.

## Rollback

- Switch `site_access_policy.mode` back to `public` from the admin panel, or with a direct database update during an incident.
- Restore a user with `product_access_status = 'approved'` and clear `product_access_expires_at` if an approval was too restrictive.
- Remove faulty app permission overrides by marking the active override row inactive with `revoked_at` and `revoked_by`.
- Deploy the previous application version while leaving the additive columns and tables in place.
- Do not drop launch-access tables or profile columns during incident rollback; they are additive and preserve audit context.

## Known Operational Limits

- Previously issued signed media URLs remain valid until their configured expiry.
- New registrations are controlled by `site_access_policy.allow_signups` in the Capinsta UI. Supabase dashboard-level provider settings remain the final provider-level kill switch.
- Production verification requires a reachable control-plane database; production code fails closed when the control plane is unavailable.
