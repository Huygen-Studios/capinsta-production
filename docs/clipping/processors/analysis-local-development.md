# Analysis worker local development

Handlers are disabled by default. Enable both with:

```text
ENABLE_TRANSCRIPT_ANALYSIS_HANDLERS=true
TRANSCRIPT_ANALYSIS_JOB_TYPES=silence_analysis,transcript_analysis
```

For transcript-only workers select only `transcript_analysis`; FFmpeg and
Storage are then not initialized. Silence workers require FFmpeg and the same
private Storage backend used by durable transcription. Planning has a separate
`ENABLE_TRANSCRIPT_ANALYSIS_PLANNING=false` gate.

Useful verification:

```text
python -m compileall -q backend
python -m pytest backend/tests/test_transcript_analysis.py -q
python -m pytest backend/tests/test_transcript_analysis_postgres.py -q
bun x tsc --noEmit
```

The PostgreSQL suite expects the repository's disposable PostgreSQL 17 test
environment. The unit suite generates synthetic tone/silence audio locally and
requires no network access.

Timeout defaults are 600 seconds for silence and 120 seconds for transcript
review. Cancellation, shutdown, or lease loss prevents finalization.
