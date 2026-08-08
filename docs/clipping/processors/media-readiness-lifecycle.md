# Durable media readiness lifecycle

Verified upload completion records the stable object identity and creates a
revision-guarded job:

```text
ready_for_probe -> probing -> ready
                           -> probe_failed
```

`probing` is an execution state and does not itself change the media revision.
The final metadata transition increments it, so `expectedMediaRevision`
remains a precise replacement guard throughout the attempt.

Retryable environmental failures leave the asset `probing`; the job enters
`retry_wait`, and another attempt may resume only while both revisions still
match. Exhausted or permanent failures atomically store a bounded
`probeFailure` summary and transition to `probe_failed`.

User cancellation terminates FFprobe, returns the matching asset to
`ready_for_probe`, and acknowledges the job as cancelled. Shutdown or lease
loss does not let the old attempt rewrite the asset. Recovery may reclaim the
job, and only the new claim token can finalize.

Replacement switches to a new path and storage-object revision. An older probe
is rejected before metadata persistence. Deleted and deletion-pending assets
cannot be probed.

Success uses one transaction for the asset update, job output/completion, and
attempt completion. A crash before commit rolls everything back; a crash after
commit leaves the job terminal and therefore not reclaimable.

