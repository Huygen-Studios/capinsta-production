-- Stage 2.3 durable PostgreSQL worker leases and append-oriented attempts.
-- Existing SQLite caption/export execution is intentionally unchanged.

ALTER TABLE "processing_jobs"
  ADD COLUMN "claim_token" uuid,
  ADD COLUMN "lease_expires_at" timestamptz,
  ADD COLUMN "claimed_at" timestamptz,
  ADD COLUMN "last_attempt_started_at" timestamptz,
  ADD COLUMN "next_retry_at" timestamptz,
  ADD COLUMN "failure_code" text,
  ADD COLUMN "failure_message" text,
  ADD COLUMN "last_worker_id" text,
  ADD COLUMN "execution_timeout_seconds" integer,
  ADD COLUMN "cancel_reason" text;

-- A pre-2.3 active row has no provable lease owner. Preserve the row and its
-- history, but reconcile it into a safe durable state rather than allowing a
-- legacy worker ID to keep unleased ownership after deployment.
UPDATE "processing_jobs" SET
  "last_worker_id" = "worker_id",
  "status" = CASE
    WHEN "status" = 'cancel_requested' THEN 'cancelled'
    WHEN "attempt_count" < "max_attempts" THEN 'retry_wait'
    ELSE 'failed'
  END,
  "available_at" = CASE
    WHEN "status" <> 'cancel_requested'
      AND "attempt_count" < "max_attempts" THEN now()
    ELSE "available_at"
  END,
  "next_retry_at" = CASE
    WHEN "status" <> 'cancel_requested'
      AND "attempt_count" < "max_attempts" THEN now()
    ELSE NULL
  END,
  "failure_code" = CASE
    WHEN "status" = 'cancel_requested' THEN NULL
    ELSE 'worker_lease_migration_recovery'
  END,
  "failure_message" = CASE
    WHEN "status" = 'cancel_requested' THEN "failure_message"
    ELSE 'Legacy active job had no claim token or lease'
  END,
  "error" = CASE
    WHEN "status" = 'cancel_requested' THEN "error"
    ELSE COALESCE(
      "error",
      jsonb_build_object(
        'code','worker_lease_migration_recovery',
        'message','Legacy active job had no claim token or lease',
        'retryable',"attempt_count" < "max_attempts",
        'details','{}'::jsonb
      )
    )
  END,
  "cancelled_at" = CASE
    WHEN "status" = 'cancel_requested' THEN now()
    ELSE "cancelled_at"
  END,
  "finished_at" = CASE
    WHEN "status" = 'cancel_requested' OR "attempt_count" >= "max_attempts"
      THEN now()
    ELSE NULL
  END,
  "worker_id" = NULL,
  "claim_token" = NULL,
  "lease_expires_at" = NULL,
  "revision" = "revision" + 1,
  "updated_at" = now()
WHERE "status" IN ('claimed','running','cancel_requested');

-- Existing heartbeat_at is the authoritative last heartbeat timestamp.
ALTER TABLE "processing_jobs"
  ADD CONSTRAINT "processing_jobs_execution_timeout_check"
    CHECK ("execution_timeout_seconds" IS NULL OR "execution_timeout_seconds" > 0),
  ADD CONSTRAINT "processing_jobs_active_lease_check"
    CHECK (
      "status" NOT IN ('claimed','running','cancel_requested')
      OR (
        "worker_id" IS NOT NULL
        AND "claim_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "processing_jobs_inactive_lease_check"
    CHECK (
      "status" IN ('claimed','running','cancel_requested')
      OR (
        "worker_id" IS NULL
        AND "claim_token" IS NULL
        AND "lease_expires_at" IS NULL
      )
    ),
  ADD CONSTRAINT "processing_jobs_retry_timestamp_check"
    CHECK (
      "status" <> 'retry_wait'
      OR COALESCE("next_retry_at","available_at") IS NOT NULL
    );

CREATE UNIQUE INDEX "processing_jobs_active_claim_token_key"
  ON "processing_jobs" ("claim_token")
  WHERE "claim_token" IS NOT NULL;
DROP INDEX IF EXISTS "processing_jobs_status_available_idx";
CREATE INDEX "processing_jobs_claim_idx"
  ON "processing_jobs" (
    "status","available_at","priority" DESC,"created_at","id"
  )
  WHERE "status" = 'queued';
CREATE INDEX "processing_jobs_lease_expiry_idx"
  ON "processing_jobs" ("lease_expires_at","id")
  WHERE "status" IN ('claimed','running','cancel_requested');
CREATE INDEX "processing_jobs_media_idx" ON "processing_jobs" ("media_asset_id");

CREATE TABLE "processing_job_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id" uuid NOT NULL REFERENCES "processing_jobs"("id") ON DELETE CASCADE,
  "attempt_number" integer NOT NULL,
  "worker_id" text NOT NULL,
  "claim_token" uuid NOT NULL,
  "status" text NOT NULL,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "lease_expires_at" timestamptz,
  "error" jsonb,
  "output_summary" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "processing_job_attempts_number_check" CHECK ("attempt_number" >= 1),
  CONSTRAINT "processing_job_attempts_status_check" CHECK ("status" IN (
    'claimed','running','succeeded','failed','retry_wait','lease_expired',
    'cancel_requested','cancelled'
  )),
  CONSTRAINT "processing_job_attempts_job_number_key"
    UNIQUE ("job_id","attempt_number"),
  CONSTRAINT "processing_job_attempts_claim_token_key" UNIQUE ("claim_token")
);

CREATE INDEX "processing_job_attempts_job_created_idx"
  ON "processing_job_attempts" ("job_id","created_at" DESC);

-- Stage 2.1 granted table-wide SELECT before worker-secret columns existed.
-- Replace it with an explicit client-safe projection so claim tokens, leases,
-- worker identities, raw errors, and internal heartbeat state cannot leak.
REVOKE SELECT ON "processing_jobs" FROM authenticated;
GRANT SELECT (
  "id","owner_user_id","project_id","media_asset_id","job_type","status",
  "priority","progress","current_stage","input","output","idempotency_key",
  "attempt_count","max_attempts","available_at","next_retry_at","failure_code",
  "failure_message","execution_timeout_seconds","cancel_reason","started_at",
  "finished_at","cancel_requested_at","cancelled_at","revision","created_at",
  "updated_at"
) ON "processing_jobs" TO authenticated;

ALTER TABLE "processing_job_attempts" ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON "processing_job_attempts" TO service_role;
-- No authenticated policy: browser users read sanitized job state, not worker
-- identities, claim tokens, or internal attempt failures.
