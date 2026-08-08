# Transcription provider routing

Durable transcription does not introduce a router. It snapshots the existing
active `TranscriptionConfigSnapshot` and passes it to
`ai_pipeline.main.run_pipeline`.

The controlled production catalog currently supports:

- Sarvam `saaras` models, including the existing long-audio chunk path.
- OpenAI `whisper-1` and existing GPT-4o transcription catalog entries.
- Gemini transcription catalog entries.
- The legacy environment router may identify `groq_whisper`; durable startup
  uses the active production configuration and does not add or reorder it.

An active snapshot is strict by default, so the configured provider/model is
deterministic and an arbitrary browser-selected model is impossible. Existing
legacy environment routing prefers configured Sarvam, Gemini, then OpenAI
according to its established availability and language behavior. Existing
fallback behavior is preserved only when the selected snapshot/pipeline
already permits it. A provider preference in durable input is a controlled
constraint and must match the active snapshot.

Supported application language modes remain `auto`, `english`, `hindi`,
`telugu`, `hinglish`, `telgish`, and `auto_mixed_indian`. Existing central
mapping resolves provider codes and mixed-language behavior; provider-specific
codes do not become the durable language-mode contract. Transcription neither
silently translates nor adds transliteration beyond existing pipeline rules.

The existing Sarvam implementation chunks long inputs using deterministic
chunk order/offset merging. Other providers retain their current full-file or
existing adapter behavior. Stage 2.6 adds no second chunk store and publishes
no partial chunk result. The configured source limit is 2 GB by default;
provider-specific duration and request limits remain those of existing
adapters and services.

Credentials and provider configuration stay in the worker environment and
active server-side snapshot. Enabling the handler validates one usable active
catalog selection and its required credential. Disabled workers require no
provider secret.

