-- Stage 3.1: revision-bound Rust runtime result identities.

ALTER TABLE "clip_projects"
  ADD COLUMN "latest_derivation_transcript_revision" bigint,
  ADD COLUMN "latest_derivation_result_identity" text,
  ADD COLUMN "latest_conversion_result_identity" text,
  ADD CONSTRAINT "clip_projects_runtime_transcript_revision_check"
    CHECK (
      "latest_derivation_transcript_revision" IS NULL
      OR "latest_derivation_transcript_revision">=1
    ),
  ADD CONSTRAINT "clip_projects_derivation_identity_check"
    CHECK (
      "latest_derivation_result_identity" IS NULL
      OR "latest_derivation_result_identity" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "clip_projects_conversion_identity_check"
    CHECK (
      "latest_conversion_result_identity" IS NULL
      OR "latest_conversion_result_identity" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "clip_projects_derivation_cache_identity_check" CHECK (
    "latest_derivation_result_identity" IS NULL
    OR (
      "latest_edl" IS NOT NULL
      AND "latest_edl_revision" IS NOT NULL
      AND "latest_derivation_transcript_revision" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "clip_projects_conversion_cache_identity_check" CHECK (
    "latest_conversion_result_identity" IS NULL
    OR (
      "latest_conversion_result" IS NOT NULL
      AND "latest_conversion_revision" IS NOT NULL
    )
  );

REVOKE INSERT,UPDATE,DELETE ON "clip_projects" FROM authenticated;
