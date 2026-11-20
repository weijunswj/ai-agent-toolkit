Title: local default branch catches up at session start

### Added

- **Local default branch catches up at session start:** at each session start and resume on a computer, in Claude Code and Codex, a checkout that is on its default branch, clean and strictly behind origin is fast-forwarded to the commit the governance session start just fetched, so chats and owner tests no longer run on old code. It adds no network read, runs no repository hook, never resets, switches, stashes or forces, and leaves Toolkit's own checkouts to the bridge.
- **One line only when it matters:** the session sees one line when the checkout moved (asking it to read `AGENTS.md` and `CLAUDE.md` again when the move changed them), or one line naming why a default branch that is behind was not moved: uncommitted changes, an operation in progress, local commits not on origin, merge hooks or LFS filters, an upstream that is not origin, or git being busy. Another branch, a detached `HEAD` or an up-to-date checkout prints nothing.

### Fixed

- **Governance reads run git from its PATH location:** the session start's read of origin's default branch spawned a bare `git` in the repository's folder, which on Windows can run a `git.exe` placed in that repository. It now runs git from its PATH location, as the bridge does.
