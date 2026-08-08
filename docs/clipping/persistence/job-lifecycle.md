# Processing job lifecycle

Durable jobs are now claimed and executed through the separate, feature-flagged
PostgreSQL worker described under `docs/clipping/jobs/`.

Allowed transitions:

| From | To |
| --- | --- |
| `queued` | `claimed`, `cancel_requested`, `cancelled` |
| `claimed` | `running`, `retry_wait`, `failed`, `cancel_requested` |
| `running` | `succeeded`, `failed`, `retry_wait`, `cancel_requested` |
| `retry_wait` | `queued`, `cancel_requested`, `cancelled` |
| `cancel_requested` | `cancelled`, `failed` |

`succeeded`, `failed`, `cancelled`, and `expired` are terminal. Invalid
transitions raise `invalid_job_transition`. Updates use an expected revision,
lock the row, change state/timestamps, and increment revision atomically.
Atomic claiming increments `attempt_count`; entering `running` does not
increment it again. Success forces progress to 100.
Progress is constrained to 0–100. Retry scheduling records `available_at`;
cancellation records request/final timestamps; active jobs may record a
heartbeat, worker identifier, unpredictable claim token, and expiring lease.
Worker mutations require the current worker/token/lease tuple. Attempts are
append-oriented in `processing_job_attempts`; terminal transitions clear active
lease fields.

Supported job types include media probing, proxy/audio extraction,
transcription and analysis, silence/highlight analysis, clip/caption export,
and project conversion. Typed V1 input envelopes currently cover
transcription, clip/caption export, project conversion, and generic analysis
metadata. These payloads contain references and policy inputs, not secrets.

Durable transcription additionally owns a paired transcript lifecycle:
`queued -> transcribing -> normalizing -> ready`, with terminal `failed` and
`deleted`. Retryable attempts do not poison the transcript. Permanent failure
and success each update transcript, job, and attempt in one transaction.
Cancellation returns an in-progress transcript to a controlled queued state;
stale revisions, lost leases, and deleted transcripts cannot become ready.
# Analysis lifecycle

Planning atomically creates/reuses an analysis and job. Analysis progresses
`queued → analyzing → normalizing → ready`; permanent failure records `failed`.
Success validates the active lease and all media/transcript/audio revisions,
then writes the document, proposed recommendations, succeeded job and succeeded
attempt in one transaction. Cancellation releases in-progress analysis back to
queued while the worker's controlled cancellation path finalizes the job.
