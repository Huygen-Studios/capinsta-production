# Transcription audio extraction

Preset `transcription-wav-16k-mono-v1` maps only the primary audio stream
selected by `media_probe`. It produces deterministic WAV containing PCM signed
16-bit little-endian audio at 16,000 Hz and one channel.

No loudness normalization, silence removal, VAD, splitting, or transcription
occurs. A missing audio stream is a permanent `audio_stream_missing` failure.
FFprobe verification checks codec, sample rate, channel count, absence of video,
and duration within the configured tolerance before upload.
