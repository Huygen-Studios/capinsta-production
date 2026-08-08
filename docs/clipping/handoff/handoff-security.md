# Handoff security

All endpoints use verified Supabase authentication; owner IDs are never
accepted from request bodies. Repository queries scope both project and asset
ownership. Foreign handoff lookup/claim returns the same not-found boundary.

`project_handoffs` has RLS. Authenticated users can select only safe status
columns for their own rows and cannot directly insert, update, delete, read
manifest JSON, read request/conversion identities, or read raw failures.
Trusted FastAPI database operations own mutations. A trigger enforces project,
owner, and claimant identity.

Preparation requires an `Idempotency-Key`. The key is scoped to actor and
project; reuse with different input conflicts. The canonical handoff identity
contains no token or timestamp. Handoff IDs are not bearer secrets and are
useless without the matching authenticated owner.

Portable validation rejects authorization material, signed access data, blob
or file URLs, storage paths, and absolute backend paths. Signed URLs exist only
inside API responses and browser memory and are not logged by application code.

