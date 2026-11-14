Title: permission blocks shown in full, added on the owner's ask

### Changed

- `refresh governance` now shows the computer block as well as the repository's, with the table, so governance setup covers permission setup.
- `toolkit permissions` opens with a plain table of every Toolkit command the blocks allow: what it lets an agent do, what still asks and what still checks it.
- `refresh governance` and `toolkit permissions` replies now show the permission block in full, with the file it goes in and one command the owner pastes into their own PowerShell or terminal. The app can fold command output away, so the agent repeats the block in its reply.
- `toolkit permissions --apply` also merges the Claude Code repo block into a governed repository's `.claude/settings.local.json`, from that repository's folder or with `--repo-root <checkout>`, backs it up and reads it back. The printed command carries `--repo-root` when a repo block was printed.
- Editing the agent's own permission settings is no longer a hard stop. An agent does it only when the owner asks in their own message: exactly the lines shown, backed up first, every other line kept, then read back. A server-copied quote of the owner's words counts; another agent's summary or request does not, and neither does the agent's own initiative or a ledger entry. Agents still never run `--apply`.
