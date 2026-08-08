# FFmpeg media-variant security

`FFmpegRunner` executes only in the trusted backend worker. It uses
`asyncio.create_subprocess_exec`, never a shell, and accepts commands assembled
only by the four server-owned handlers. Clients cannot select an executable,
protocol, stream map, codec, filter graph, input, output, or local path.

Every command includes `-nostdin`, a source-specific protocol allowlist,
bounded stderr, bounded `-progress pipe:1`, and a hard timeout. Cancellation,
lease loss, and worker shutdown terminate the process group, wait a short grace
period, then kill and await it to prevent zombies. Diagnostics replace the
exact source and all HTTP URLs and retain only a bounded final line.

Sources are either trusted local paths or ephemeral private HTTPS URLs from the
existing probe-source abstraction. Generated data is written only below
`{MEDIA_VARIANT_TEMP_ROOT}/{jobId}/{attemptNumber}` with server-owned names.
The context cleans that directory after success, failure, timeout,
cancellation, lease loss, or shutdown.

FFmpeg never uploads directly. The worker checks local existence and size,
performs type-specific FFprobe/JSON verification, computes SHA-256, then uses a
trusted backend Storage upload. Signed URLs, command lines, local paths,
credentials, and raw stderr are never persisted.
