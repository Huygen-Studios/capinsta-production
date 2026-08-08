# Observability And SLOs

## Request Tracing

Every API response should carry `X-Request-ID`. Propagate it through Next, FastAPI, worker logs, provider calls, and export logs.

Trace spans should show:

- authentication
- rate-limit decision
- validation
- DB pool wait and query time
- queue admission and queue age
- provider latency
- FFmpeg/VAD/stable-ts/export duration
- storage read/write time

## Metrics

Track p50/p95/p99 latency, error rate, queue depth/age, DB pool wait, DB lock wait, cache hit/miss, CPU, memory, disk capacity, temp capacity, file descriptors, worker heartbeat, provider latency/error rate, upload rejection reasons, and export/transcription duration.

## Alert Starting Points

- API p95 latency above 2s for 10 minutes.
- Queue age above 5 minutes.
- Disk free below `DISK_WARNING_FREE_BYTES`.
- Any DB pool checkout timeout.
- Provider error rate above 10% over 5 minutes.
- Worker heartbeat stale beyond lease timeout.

