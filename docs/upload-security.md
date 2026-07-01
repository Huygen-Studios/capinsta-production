# Upload Security

## Supported Formats

Caption/job source uploads currently require video: MP4/MOV/M4V.

Media assets used by the editor allow:

- Video: MP4, MOV, M4V
- Audio: MP3, WAV, M4A, AAC, OGG
- Images: PNG, JPEG, WEBP, GIF

SVG, HTML, XML, JavaScript, PHP, shell scripts, archives, executables, documents, and double-extension bypasses are rejected.

## Validation Layers

1. Basename extraction; original names are never used as filesystem paths.
2. Unsafe character rejection.
3. Extension allowlist.
4. Dangerous prior-extension rejection, such as `shell.php.jpg`.
5. Declared MIME allowlist.
6. Magic-byte sniffing.
7. Suffix-to-magic kind match.
8. Image dimension limit.
9. FFprobe validation for audio/video duration, stream count, and dimensions.
10. Server-generated object keys under user/project scoped storage.

## Storage Rules

- Runtime media is stored outside the frontend public root.
- Upload, media, export, and temp roots must not be mounted as static paths.
- Production mounts should be non-executable and non-browsable.
- Do not extract archives in production.
- Serve downloads with `Content-Disposition`, private cache headers, and `X-Content-Type-Options: nosniff`.

