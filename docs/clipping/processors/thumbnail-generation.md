# Poster thumbnail generation

Preset `poster-jpeg-v1` produces one JPEG with maximum width 640, preserved
aspect ratio, no upscaling, bounded FFmpeg quality `3`, and stripped metadata.
FFmpeg applies display rotation while decoding.

The server selects `min(10% of duration, 5000 ms)`, clamps it inside the
duration, and uses the beginning for very short media. Client-selected
timestamps are intentionally not accepted because timestamp choice is part of
variant identity. There is no scene, face, or album-art selection. Audio-only
media is not planned and is permanently unsupported.
