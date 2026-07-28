# Waveform generation

Preset `waveform-peaks-v1` decodes the selected primary audio stream to
temporary mono PCM S16LE at 16 kHz. Python reads that file in bounded chunks
and records an integer min/max pair for each deterministic 10 ms bucket.

The private JSON artifact is:

```json
{
  "schemaVersion": 1,
  "mediaAssetId": "00000000-0000-0000-0000-000000000000",
  "sourceMediaRevision": 1,
  "durationMs": 1000,
  "sampleRateHz": 16000,
  "channelMode": "mono",
  "bucketDurationMs": 10,
  "peakEncoding": "signed-int16-min-max",
  "peaks": [[-1200, 1450]]
}
```

Values remain within signed int16 and the default maximum is 200,000 pairs.
Full PCM is never uploaded. Task 2.5 uses independent source processing; the
ready extracted WAV is not yet used as a soft dependency, avoiding waiting or
a new DAG scheduler.
