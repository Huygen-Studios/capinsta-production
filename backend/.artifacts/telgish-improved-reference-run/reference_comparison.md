# Timing Reference Comparison

Result: FAIL
Failures: 1
Pause split seconds: 0.25
Hard boundary guard seconds: 0.12

## Effective Configuration

- Timing policy: native_then_forced
- Stable-ts model: small
- Allow stable-ts order fallback: False
- Caption max words: 3

## Hard Boundaries

## Failures
- `pipeline_preflight_failed`: {'type': 'pipeline_preflight_failed', 'message': 'No configured STT provider API secret is available in the local environment.', 'missingSecrets': ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'SARVAM_API_KEY']}
