# Media variant planning

`MediaVariantPlanningService` locks a ready asset, reads the successful probe
result for the current media revision, and creates variant rows plus jobs in
one PostgreSQL transaction.

The deterministic matrix is:

- video with audio: proxy, thumbnail, extracted audio, waveform;
- video without audio: proxy and thumbnail;
- audio: extracted audio and waveform.

The generation identity unique index and processing-job idempotency key make
repeated and concurrent planning converge on the existing variant and active
job. A replacement source revision receives new identities and paths. Ready
variants are reused; failed rows are not silently requeued by planning.

When `ENABLE_MEDIA_VARIANT_PLANNING=true`, media-probe finalization invokes the
same planner inside its asset/job transaction. It may also be called explicitly.
Planning never executes a handler.
