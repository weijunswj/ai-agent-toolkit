### Added

- **Escape list:** `repo/scripts/toolkit-escape-ledger.cjs` keeps one line per bug found after merge in the private evidence store (`state/<owner>/<repo>/escapes.jsonl`, beside the repository's programme state): what broke, why the tests missed it, the kind of test that should have caught it, who found it, and the fix and test once they exist. `add` writes a line, `fix` fills the fix and test once, `check` validates the file and `group` prints counts per kind and the escapes with no test yet, never the text. The reader refuses anything outside its exact format, and any text holding a local path, a secret-shaped value, personal data or an AI footer.
- **Controller findings:** a bug found after merge now also gets its escape-list line the same turn.
