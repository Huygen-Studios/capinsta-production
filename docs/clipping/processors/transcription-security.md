# Transcription security

Durable job inputs are `extra=forbid` contracts containing stable IDs and
controlled policy only. They cannot carry URLs, paths, buckets, credentials,
provider endpoints/models, executables, raw transcripts, or provider
responses. Metadata recursively rejects sensitive key names, paths, URLs,
control characters, and unbounded strings/lists.

The repository resolves only the owner-bound, ready, current-revision WAV
variant. Local objects are copied to a per-attempt temporary directory. Remote
sources must be ephemeral HTTPS, use no redirects, and have bounded
connect/read time and bytes. Signed values are neither logged nor persisted.
The child provider process receives only the temporary path and server-side
configuration and is terminated on timeout/control loss.

Ordinary logs contain job/provider identity and safe codes, never full audio
URLs, transcript payloads, provider raw responses, credentials, or absolute
temporary paths. Job output and failure metadata are bounded safe summaries.

Migration `0019` retains owner-scoped authenticated transcript reads but no
browser write grant. It excludes internal `result_identity` and `failure`
columns from authenticated column privileges. Existing RLS prevents
cross-owner/anonymous reads; trusted service-role workers alone perform
authoritative writes. Processing claim tokens and attempt rows remain hidden.

Provider credentials and the Supabase service role remain server-side
deployment secrets. Workers do not expose a port. Media is sent only through
the existing selected provider/fallback policy.

