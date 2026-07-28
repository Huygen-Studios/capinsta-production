# Contract fixture generation

Run `cargo run -p clip-domain --bin generate-contract-fixtures` from the repository root. The opt-in command uses the authoritative Rust EDL and transcript-remapping APIs and deterministically rewrites only valid JSON in:

- `contracts/fixtures/edit-decision-list-v1/valid`
- `contracts/fixtures/remapped-transcript-v1/valid`

Invalid fixtures under sibling `invalid/` directories are manually maintained and never overwritten. Ordinary Rust, Bun, and Python tests only read fixtures. After regeneration, review `git diff -- contracts/fixtures` and validate with `cargo test -p clip-domain`, `bun test packages/transcript-contract/src/index.test.ts`, and the focused backend contract tests.
