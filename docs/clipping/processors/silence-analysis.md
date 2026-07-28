# Durable silence analysis

`silence_analysis` uses the ready `transcription-wav-16k-mono-v1` private audio
variant and the server-owned `speech-silence-v1` preset. The existing Silero
path was not selected because its Torch/Torchaudio dependencies are optional
and unavailable in the standard worker runtime. No new VAD dependency is
introduced.

The fixed FFmpeg `silencedetect` configuration is:

- minimum silence: 500 ms
- noise threshold: -35 dB
- merge gap: 100 ms
- recommendation edge padding: 100 ms
- minimum retained speech: 250 ms
- leading/trailing analysis enabled

Clients cannot provide filters, executable paths, storage paths or URLs.
FFmpeg runs without a shell or stdin, under a hard timeout and process group.
The worker bounds stderr, observes cancellation and lease loss, terminates the
process, and deletes its temporary workspace. Signed URLs are ephemeral and
never enter results or failures.

Events are decimal-parsed and converted with half-up millisecond rounding.
Missing trailing ends close at media duration with a warning; reconstructable
missing starts use the reported duration. Negative, beyond-duration,
contradictory, or irreparable ordering is rejected. Short events are filtered;
nearby events merge deterministically; normalized intervals never overlap.

Removal proposals are omitted when padding collapses the interval, retained
speech would be too short, or a timed transcript word overlaps it.
