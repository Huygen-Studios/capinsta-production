# Media metadata normalization

Normalization is deterministic and separate from subprocess execution.
Unknown FFprobe fields and arbitrary tags are ignored.

Duration priority is format, primary video, primary audio, then the maximum
valid supported-stream duration. Decimal seconds use `Decimal` and round
half-up to the nearest integer millisecond. Negative, non-finite, malformed,
and policy-excessive durations are not persisted.

FPS prefers `avg_frame_rate` and falls back to `r_frame_rate`. Valid fractions
are reduced and stored as numerator/denominator. `N/A`, `0/0`, invalid
denominators, and values above the configured maximum are unavailable and
produce deterministic warnings. FPS is never persisted as a float.

Attached cover-art video streams are excluded. Video selection prefers default
disposition, largest encoded area, then lowest index. Audio selection prefers
default disposition, channel count, sample rate, then lowest index.

Rotation is read from display side data before the `rotate` tag and normalized
to 0, 90, 180, or 270 degrees. For 90/270, durable `width` and `height` are
swapped to represent display orientation. Encoded and coded dimensions remain
in bounded probe metadata and output.

A supported video stream produces `mediaKind=video`; otherwise supported audio
produces `mediaKind=audio`. Declared MIME, stored MIME, and extension
disagreements are warnings rather than automatic rejection. Audio-only assets
keep dimensions and FPS null.

