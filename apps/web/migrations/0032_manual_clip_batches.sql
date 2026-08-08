-- Editor-first manual multi-clip batches. Source media and editor projects remain shared.

BEGIN;

CREATE TABLE "clip_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "source_media_asset_id" uuid NOT NULL REFERENCES "media_assets"(id) ON DELETE RESTRICT,
  "source_media_revision" bigint NOT NULL,
  "source_project_id" text REFERENCES "clip_projects"(id) ON DELETE SET NULL,
  "title" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "platform_preset" text NOT NULL DEFAULT 'instagram_reels',
  "captions_enabled" boolean NOT NULL DEFAULT false,
  "headings_enabled" boolean NOT NULL DEFAULT false,
  "caption_preset" text,
  "maximum_clip_duration_ms" bigint NOT NULL DEFAULT 180000,
  "revision" bigint NOT NULL DEFAULT 1,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "clip_batches_status_check" CHECK (status IN ('draft','materializing','ready','exporting','completed','failed','cancelled')),
  CONSTRAINT "clip_batches_platform_check" CHECK (platform_preset IN ('instagram_reels','youtube_shorts','tiktok','custom')),
  CONSTRAINT "clip_batches_duration_check" CHECK (maximum_clip_duration_ms BETWEEN 1 AND 180000),
  CONSTRAINT "clip_batches_title_check" CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT "clip_batches_revision_check" CHECK (revision >= 1)
);

CREATE TABLE "clip_batch_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id" uuid NOT NULL REFERENCES "clip_batches"(id) ON DELETE CASCADE,
  "ordinal" integer NOT NULL,
  "title" text NOT NULL,
  "source_start_ms" bigint NOT NULL,
  "source_end_ms" bigint NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "selected_for_export" boolean NOT NULL DEFAULT true,
  "child_project_id" text REFERENCES "clip_projects"(id) ON DELETE SET NULL,
  "child_project_revision" bigint,
  "caption_status" text NOT NULL DEFAULT 'not_requested',
  "caption_job_id" text,
  "heading_status" text NOT NULL DEFAULT 'not_requested',
  "export_status" text NOT NULL DEFAULT 'not_requested',
  "revision" bigint NOT NULL DEFAULT 1,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "clip_batch_items_ordinal_unique" UNIQUE (batch_id, ordinal),
  CONSTRAINT "clip_batch_items_ordinal_check" CHECK (ordinal > 0),
  CONSTRAINT "clip_batch_items_title_check" CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT "clip_batch_items_range_check" CHECK (
    source_start_ms >= 0 AND source_end_ms > source_start_ms
    AND source_end_ms - source_start_ms <= 180000
  ),
  CONSTRAINT "clip_batch_items_status_check" CHECK (status IN ('draft','materializing','ready','failed','cancelled')),
  CONSTRAINT "clip_batch_items_caption_status_check" CHECK (caption_status IN ('not_requested','queued','processing','completed','failed','cancelled')),
  CONSTRAINT "clip_batch_items_heading_status_check" CHECK (heading_status IN ('not_requested','pending','completed','failed','cancelled')),
  CONSTRAINT "clip_batch_items_export_status_check" CHECK (export_status IN ('not_requested','queued','processing','completed','failed','cancelled')),
  CONSTRAINT "clip_batch_items_revision_check" CHECK (revision >= 1),
  CONSTRAINT "clip_batch_items_project_revision_check" CHECK (child_project_revision IS NULL OR child_project_revision >= 1)
);

CREATE INDEX "clip_batches_owner_updated_idx" ON "clip_batches"(owner_user_id, updated_at DESC);
CREATE INDEX "clip_batch_items_batch_ordinal_idx" ON "clip_batch_items"(batch_id, ordinal) WHERE deleted_at IS NULL;

CREATE TABLE "clip_batch_exports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "batch_id" uuid NOT NULL REFERENCES "clip_batches"(id) ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'processing',
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "manifest" jsonb,
  "storage_provider" text,
  "storage_bucket" text,
  "storage_path" text,
  "size_bytes" bigint,
  "checksum" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "ready_at" timestamptz,
  "deleted_at" timestamptz,
  CONSTRAINT "clip_batch_exports_status_check" CHECK (status IN ('processing','ready_for_zip','zipping','ready','partial_failure','failed','cancelled')),
  CONSTRAINT "clip_batch_exports_storage_check" CHECK ((storage_bucket IS NULL) = (storage_path IS NULL)),
  CONSTRAINT "clip_batch_exports_idempotency_unique" UNIQUE(owner_user_id, batch_id, idempotency_key)
);

CREATE TABLE "clip_batch_export_items" (
  "batch_export_id" uuid NOT NULL REFERENCES "clip_batch_exports"(id) ON DELETE CASCADE,
  "clip_batch_item_id" uuid NOT NULL REFERENCES "clip_batch_items"(id) ON DELETE RESTRICT,
  "clipping_export_id" uuid NOT NULL REFERENCES "clipping_exports"(id) ON DELETE RESTRICT,
  "ordinal" integer NOT NULL,
  "filename" text NOT NULL,
  PRIMARY KEY(batch_export_id, clip_batch_item_id),
  UNIQUE(batch_export_id, clipping_export_id)
);

ALTER TABLE "clip_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clip_batch_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clip_batch_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clip_batch_export_items" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON "clip_batches", "clip_batch_items", "clip_batch_exports", "clip_batch_export_items" TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON "clip_batches", "clip_batch_items", "clip_batch_exports", "clip_batch_export_items" TO service_role;
REVOKE INSERT,UPDATE,DELETE ON "clip_batches", "clip_batch_items", "clip_batch_exports", "clip_batch_export_items" FROM authenticated;

CREATE POLICY "clip_batches_owner_select" ON "clip_batches"
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "clip_batch_items_owner_select" ON "clip_batch_items"
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM "clip_batches" b WHERE b.id = batch_id AND b.owner_user_id = auth.uid())
  );
CREATE POLICY "clip_batch_exports_owner_select" ON "clip_batch_exports"
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "clip_batch_export_items_owner_select" ON "clip_batch_export_items"
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM "clip_batch_exports" e WHERE e.id = batch_export_id AND e.owner_user_id = auth.uid())
  );

COMMIT;
