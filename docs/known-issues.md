# Known Issues

## Inherited OpenCut Classic Test Failures

The full frontend test suite currently has non-Capinsta failures in inherited OpenCut Classic areas:

- mask snapping uniform-scale expectation
- text mask measurement context in the Bun test environment
- custom mask insertion handle expectation
- timeline placement fixture using fractional media time

Focused Capinsta tests and Capinsta export render tests pass.

## Release Candidate Gate

The final human visual pass across all six presets and exported MP4 parity should be completed before marking a production release, unless already verified by the release owner.

## Export Limitation

timingNeedsReview clips export static captions without active-word effects until timing is rebuilt.
