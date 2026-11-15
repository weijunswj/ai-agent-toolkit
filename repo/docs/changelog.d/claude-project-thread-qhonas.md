### Added

- **Governance question bank permission lines:** `toolkit permissions` now prints the governance question bank as two exact Claude Code lines in the computer block, so the owner clicks Allow once (for the Update in the bank's permissions row, or the `--apply` command) instead of on every `toolkit governance` run, auto mode included. One line is `toolkit-governance.cjs setup`, which shows the bank. The other is `toolkit-governance.cjs setup --answers *`, which sends the owner's reply and writes nothing without that reply's live one-use ticket. `refresh`, `--json` and every other governance subcommand still ask, and Codex gets a prompt rule for the bank. The lines name the managed checkout's path, like every computer line.

### Fixed

- **Curly quotes in a bank answer:** the tool gate no longer counts a bank answer command that holds a curly quote as the exact answer command, because PowerShell reads curly quotes as quotes, so such a line could run a second command after the answer. The command is refused instead.
