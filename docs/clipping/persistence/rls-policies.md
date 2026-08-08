# Durable clipping RLS policies

RLS is enabled on all seven durable tables. Authenticated browser users can
select only rows they own. Variant and project-version ownership is resolved
through their parent row. Anonymous users have no grants or policies.

Browser mutation is intentionally denied. This is stricter than owner-write
RLS because transcript/project JSON must pass Python Stage 1 validation and
because fields such as `processing_jobs.status`, worker/error/output data, and
media Storage references are server-managed. User-initiated mutations go
through FastAPI, which derives an `AuthenticatedActor` from a verified Supabase
JWT and performs explicit `owner_user_id` predicates.

The server-only `service_role` receives table CRUD privileges and bypasses RLS,
as Supabase service roles normally do. The key must never use a `NEXT_PUBLIC_`
variable, reach browser bundles, logs, or persisted JSON. Repositories continue
to scope trusted writes to the actor.

Cross-row triggers are security-invoker functions with an empty explicit
`search_path` and fully qualified relations. No security-definer function is
used for client mutation. RLS tests set two distinct JWT subjects and verify
own reads, cross-owner denial, owner-change denial, anonymous denial, and a
trusted service-role Storage-reference update.
