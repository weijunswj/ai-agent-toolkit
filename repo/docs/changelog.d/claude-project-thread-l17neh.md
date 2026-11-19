### Changed

- **Instruction templates retired:** the governed-block template (`AGENTS.managed.template.md`) and the Antigravity bootstrap template (`antigravity-bootstrap.template.md`) are gone from `repo/contracts/agent-rules/repo-local/` and `skills/repository-agent-rules/repo-local/`. Nothing installed them: the installed Toolkit delivers the governed rules at session start, and Antigravity reads `AGENTS.md` itself. The instruction sync no longer builds them, and the merge-train re-bump no longer stamps them. The `CLAUDE.md` shim template stays: `repository-agent-rules` still installs it.
- **Toolkit source checkout:** the session-start preflight and the governance cleanup now know a Toolkit source checkout by the instruction sync script, the version file and the Claude Code plugin manifest (one shared check in `repo/scripts/toolkit-version.cjs`), so neither needs an instruction template. The cleanup still refuses a source checkout, and the preflight still compares its `CLAUDE.md` with its own template.
- **Curated header:** the curated-source comment older setups wrote at the top of `AGENTS.md` now lives in `repo/contracts/agent-rules/playbook-history.json` (`agents_header`), exactly as it last shipped, so the leftover scan and the cleanup still remove it with the governed block.

### Fixed

- **Source checkout with broken CLAUDE.md markers:** the session-start note now says to regenerate the file with the sync script, which rewrites it whole, instead of calling the fix the owner's choice with nothing due.
