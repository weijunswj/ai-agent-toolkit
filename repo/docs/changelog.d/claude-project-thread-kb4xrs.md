Title: Toolkit's own repository drops its rule copies

### Changed

- **No governed block in Toolkit's root `AGENTS.md`:** the installed Toolkit delivers the governed rules at session start here too, so the root file now holds only Toolkit's own rules, starting with "## This Repository". The Antigravity bootstrap in `.agents/rules/` is gone; Antigravity reads `AGENTS.md` itself. `CLAUDE.md` stays the one line `@AGENTS.md`.
- **Instruction sync:** `sync-agent-instruction-shims.cjs` no longer writes the governed block or the bootstrap into the root. Its check, and `--write`, now fail when root `AGENTS.md` carries any Toolkit block (even a broken marker) or the bootstrap comes back, so a stale branch cannot re-add them. The portable templates stay as they are.
- **Session start in a Toolkit checkout:** the note no longer compares root `AGENTS.md` with the managed template, which would have said to regenerate the block back in. `CLAUDE.md` is still compared with its template, and a newer checkout still says to refresh Toolkit.
- **Force-push guard:** a repository counts as governed by its working-tree `.github/toolkit-programme.json` saying `"governance": "enabled"` (even when the rest of it does not parse), alongside its governance state and the guard config. A leftover governed block alone no longer counts.
- **Version floor:** Toolkit's own binding now sets `min_toolkit` to 3.137.0, the first release with the new turn-on, the cleanup route and the session-start truncation fix, and the cleanup writes that floor too. A test keeps the cleanup's floor no newer than the Toolkit version.
- **Lists and docs:** the re-bump stamp list and the fallback audit drop the root block and the bootstrap, and the instructions playbook and bridge doc describe the hand-written root file.
