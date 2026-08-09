BEGIN;

ALTER TABLE "processing_jobs" DROP CONSTRAINT "processing_jobs_type_check";
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_type_check"
  CHECK ("job_type" IN (
    'media_probe','proxy_generation','audio_extraction','thumbnail_generation',
    'waveform_generation','transcription','transcript_analysis',
    'silence_analysis','highlight_analysis','viral_candidate_analysis',
    'smart_reframe','clip_export','caption_export','editor_export',
    'project_derivation','project_conversion'
  ));

COMMIT;
