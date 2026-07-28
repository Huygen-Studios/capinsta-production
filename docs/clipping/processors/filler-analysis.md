# Filler analysis

The `existing-preprocessor-v1` dictionary deliberately mirrors only evidence
found in the existing caption preprocessing:

- English/auto: `um`, `uh`, `er`, `ah`
- Hindi: `tum`, `ha`
- Hinglish/auto mixed Indian: the union above
- Telgish: evidenced English tokens only
- Telugu: no dictionary tokens; provider `isFiller` flags are still honored

Matching is case-folded exact-token matching after edge punctuation removal,
never substring matching. Displayed and original token text are both checked,
but neither is modified. Repetitions stay distinct. Untimed tokens produce
untimed findings. The result is a `review_filler` proposal, never automatic
removal.

Multi-token phrases are not included because the current repository contains
no production phrase dictionary or matching semantics. Adding one requires a
new versioned server preset.
