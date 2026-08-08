BEGIN;

ALTER TABLE transcription_configurations
  ADD COLUMN IF NOT EXISTS pipeline_options JSONB NOT NULL DEFAULT '{
    "schemaVersion": 1,
    "timingSourcePolicy": "native_then_forced",
    "audio": {"sampleRate": 16000, "channels": 1, "codec": "pcm_s16le", "bitrateKbps": null},
    "audioChunking": {"vadEnabled": true, "targetSeconds": 15, "maxSeconds": 25, "paddingSeconds": 0.08, "legacyNormalSeconds": 20, "legacyNormalOverlapSeconds": 4, "legacyStrictSeconds": 12, "legacyStrictOverlapSeconds": 5, "fadeMs": 0},
    "vad": {"pauseThresholdSeconds": 0.30, "silenceThresholdDb": null, "sileroEnabled": false, "sileroSpeechThreshold": 0.50, "speechMergeGapSeconds": null},
    "alignment": {"provider": "auto", "whisperxEnabled": false, "stableTsEnabled": false, "stableTsModel": "base", "stableTsDevice": "auto", "stableTsMinMatchCoverage": 0.50, "stableTsMinWordRatio": 0.45, "stableTsMaxWordRatio": 2.25, "allowStableTsOrderFallback": false},
    "repair": {"speechSpanRetimerEnabled": true, "minimumWordDurationSeconds": 0.04, "minimumInterWordGapSeconds": 0, "cadenceMinSeconds": 0.075, "cadenceMaxSeconds": 0.35, "minimumSpeechRetimeWords": 6, "minimumSpeechRetimeTrailingGapSeconds": 1.0, "speechRetimeCompressionRatio": 0.78, "minimumPhraseRetimeWords": 4},
    "autoSync": {"enabled": false, "frameStepSeconds": 0.02, "maxShiftSeconds": 2.0, "minScore": 0.58, "minImprovement": 0.04, "maxEstimatedWordRatio": 0.70, "allowSkew": false, "maxSkewDelta": 0.02},
    "captionChunking": {"targetWords": 4, "maxWords": 5, "minWords": 2, "maxCharacters": 36, "minDurationSeconds": 0.8, "maxDurationSeconds": 3.0, "pauseSplitThresholdSeconds": 0.30, "mergeGapSeconds": 0.12, "phraseHoldSeconds": 0.12},
    "quality": {"minimumProviderTimestampCoverage": 0.90, "allowSegmentDerivedWords": false, "allowEstimatedWords": false, "maximumEstimatedWordRatio": 0.15},
    "performance": {"providerTimeoutSeconds": 60, "sarvamMaxConcurrency": 2, "alignmentRetries": 3}
  }'::jsonb;

ALTER TABLE caption_jobs
  ADD COLUMN IF NOT EXISTS pipeline_options JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
