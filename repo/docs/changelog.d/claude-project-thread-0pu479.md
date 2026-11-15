Title: Enter-only owner terminal steps

### Added

- `repo/scripts/owner-terminal.cjs` is the one place Toolkit scripts print to, and confirm with, the owner's own terminal: a title line, a few `label: value` facts, at most one sentence wrapped to the window, and an OK or STOP line. Colour and markers show only on a terminal with `NO_COLOR` unset.
- Every owner confirmation is a fresh Enter, and Ctrl+C stops with nothing changed. The prompt drops anything typed or pasted before it and anything that arrives before the input has been quiet for a moment, and a pasted block never confirms, so the blank line at the end of a pasted command no longer answers it.
- The governance App setup command has a `--save both|variable|secret` step for an App made by hand: it saves the Client ID and the key file's key on the repository, reads both names back, and overwrites an App already there only with `--replace`, which `toolkit governance check` prints only on its replace route.

### Changed

- `toolkit permissions --apply` and `--remove`, the governance App setup, `toolkit governance disable` in a terminal, the `toolkit governance migrate` rulesets, `programme.cjs migrate-state --apply`, the setup RAM approval and the Codex configuration approval wait for Enter instead of a typed `apply`, `create`, `yes` or `approve`. Answer files and flags work as before.
- `toolkit env` remove, apply, connect, revoke and retire-codex-env wait for Enter when run in your own terminal; your agent still passes your chat yes or no on stdin. `toolkit env show` asks for Enter instead of the key's name. Typing a secret value stays hidden typed input.
- The governance App setup screen is a title, four facts and one sentence instead of two long paragraphs.
- The App's by-hand save commands are the setup command's `--save` step instead of long pasted PowerShell and shell lines that asked you to type `replace`.
- The global Development Principles say owner terminal steps are short and Enter-only.
