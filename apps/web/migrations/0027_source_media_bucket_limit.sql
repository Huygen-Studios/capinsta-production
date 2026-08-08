-- Keep the direct-upload bucket aligned with the production source-media policy.
-- This does not and cannot change Supabase's project-global Storage limit.

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'source-media' AND public = true
  ) THEN
    RAISE EXCEPTION 'Refusing to reuse public storage bucket source-media';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'source-media'
  ) THEN
    RAISE EXCEPTION 'source-media bucket is missing; apply storage migration 0015 first';
  END IF;

  UPDATE storage.buckets
  SET
    public = false,
    file_size_limit = 2147483648,
    allowed_mime_types = ARRAY[
      'video/mp4','video/quicktime','video/webm',
      'audio/mpeg','audio/wav','audio/x-wav','audio/mp4',
      'audio/webm','audio/ogg'
    ]::text[]
  WHERE id = 'source-media';
END $$;
