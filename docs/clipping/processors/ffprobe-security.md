# FFprobe security boundary

FFprobe parses untrusted uploaded bytes and runs only inside the backend worker
image.

The command is an argument tuple and never uses a shell:

```text
ffprobe -v error
  -protocol_whitelist <source-specific allow-list>
  -probesize <trusted configuration>
  -analyzeduration <trusted configuration>
  -show_entries <fixed allow-list>
  -of json
  <trusted resolved source>
```

Local sources allow only `file`. Private Supabase sources allow
`https,tls,tcp`. A job cannot choose the executable, source, protocols,
arguments, or output fields. The configured executable must be a safe basename
or absolute path and is validated with `ffprobe -version` when the handler is
enabled.

Stdout and stderr have independent hard byte limits. Execution uses the
shortest of the handler timeout, job timeout, and remaining signed-URL validity
minus a safety margin. Cancellation, shutdown, timeout, or lease loss
terminates the process group, waits for a short grace period, then kills it if
required. All subprocess tasks are awaited to prevent zombies.

Signed URLs exist only inside the storage context and FFprobe argument list.
They are never logged or persisted. Diagnostics replace the exact source and
all HTTP URLs, remove control characters, retain one bounded line, and never
store raw stderr. Service-role credentials are used only by the Storage REST
adapter and are never passed to FFprobe.

Container CPU and memory limits remain a deployment responsibility. The outer
hard timeout bounds protocol and network stalls.

## FFmpeg variant boundary

Task 2.5 applies the same process model to `FFmpegRunner`: fixed executable and
server-owned argument arrays, `-nostdin`, source-specific protocol allowlists,
bounded stderr and progress, a hard timeout, process-group termination, and URL
redaction. Job input cannot contain arguments, filters, paths, buckets, URLs,
or credentials. Progress uses `-progress pipe:1`, is monotonic and throttled,
and occupies 5-85%; verification, upload, and finalization use the remainder.

FFmpeg writes only to a root-confined per-attempt directory. It never writes to
a signed upload URL. Output must pass type-specific verification and size
limits before trusted backend upload. Existing caption/export FFmpeg commands
are intentionally unchanged.
