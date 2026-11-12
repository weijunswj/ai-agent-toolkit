Title: command list as tables

### Changed

- `toolkit cmd` now shows the Toolkit commands as small two-column tables (Type this, What it does), grouped Setup, Keys, Governance and Merge, instead of one long bulleted list.

### Added

- The toolkit-setup skill now handles a whole-message `toolkit cmd` or `toolkit command` when no prompt hook line came with it, for example when Codex hooks are off after an update: it runs the command list script and shows its output.
