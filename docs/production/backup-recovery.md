# Backup and recovery

Confirm the selected Supabase plan's database backup/PITR settings before
launch; Storage version recovery is separate and must not be assumed.

Recovery order: disable admissions, restore/verify PostgreSQL, redeploy the
matching application image, let leases recover workers, regenerate derived
caches, and reconcile database-recorded Storage objects. A failed additive
migration blocks rollout; restore the backup only if forward repair is unsafe.
Application rollback uses prior immutable image tags with enqueue flags off.

Test quarterly with synthetic data: database restore, lost worker, orphaned
export, and regenerated derived cache.
