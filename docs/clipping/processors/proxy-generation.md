# Editing proxy generation

Preset `editing-720p-v1` produces private MP4 with one H.264 video stream,
`yuv420p`, maximum display size 1280x720, a 2500 kbit/s bounded video rate, and
fast-start. Aspect ratio and display rotation are preserved by FFmpeg's normal
autorotation and the server-owned scale filter. Smaller media is not upscaled.

When the probed source has audio, the selected primary stream becomes stereo
AAC at 48 kHz and 128 kbit/s. Video without audio remains silent. Audio-only
media is not planned and fails permanently if a proxy job is constructed.
Source timing is preserved; no 30 FPS conversion is applied, so variable frame
rate may remain variable. Captions, crops, watermarks, and metadata are absent.

Verification requires H.264, supported dimensions and pixel format, expected
audio presence, and duration within the configured 1000 ms tolerance.
